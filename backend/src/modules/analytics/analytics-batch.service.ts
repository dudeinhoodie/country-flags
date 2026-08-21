import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { ConsentCategory, ConsentStatus, Prisma } from "@prisma/client";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";

import { redact } from "../../common/logging/redaction";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import {
  findEventDefinition,
  type EventDefinition,
} from "./analytics-event-registry";

interface BatchEventInput {
  eventId: string;
  eventName: string;
  schemaVersion: number;
  occurredAt: string;
  anonymousId: string;
  sessionId: string;
  context: Record<string, unknown>;
  properties: Record<string, string | number | boolean>;
}

interface BatchInput {
  payloadVersion: 1;
  events: BatchEventInput[];
}

export type EventOutcomeStatus = "ACCEPTED" | "DUPLICATE" | "REJECTED";

export interface EventOutcome {
  eventId: string;
  status: EventOutcomeStatus;
  rejectionCode: string | null;
}

export interface BatchIngestionResult {
  results: EventOutcome[];
  serverTime: string;
}

// A short TTL: delivered rows are cleaned up quickly, and even undelivered
// rows do not accumulate indefinitely if a delivery target is never configured.
const OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

function repositoryRoot(): string {
  return resolve(__dirname, "../../../..");
}

function loadBatchValidator(): ValidateFunction {
  const schema = JSON.parse(
    readFileSync(
      resolve(
        repositoryRoot(),
        "contracts/schemas/analytics/batch.v1.schema.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    allowUnionTypes: true,
  });
  addFormats(ajv);
  return ajv.compile(schema);
}

const validateBatchSchema = loadBatchValidator();

function propertyIssue(
  definition: EventDefinition,
  properties: Record<string, unknown>,
): string | undefined {
  for (const [name, propertyDefinition] of Object.entries(
    definition.properties,
  )) {
    const value = properties[name];
    if (value === undefined) {
      if (propertyDefinition.required) {
        return `missing required property "${name}"`;
      }
      continue;
    }
    if (
      propertyDefinition.type === "integer"
        ? !Number.isInteger(value)
        : typeof value !== propertyDefinition.type
    ) {
      return `property "${name}" has the wrong type`;
    }
    if (
      propertyDefinition.enumValues !== undefined &&
      typeof value === "string" &&
      !propertyDefinition.enumValues.includes(value)
    ) {
      return `property "${name}" has an unregistered value`;
    }
  }
  for (const name of Object.keys(properties)) {
    if (!(name in definition.properties)) {
      return `unregistered property "${name}"`;
    }
  }
  return undefined;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

@Injectable()
export class AnalyticsBatchService {
  constructor(private readonly database: PrismaService) {}

  async ingest(
    rawBody: unknown,
    authenticatedUserId: string | undefined,
  ): Promise<BatchIngestionResult> {
    if (!validateBatchSchema(rawBody)) {
      throw new UnprocessableEntityException(
        ajvErrors(validateBatchSchema.errors),
      );
    }
    const batch = rawBody as BatchInput;

    const privacySettings =
      authenticatedUserId === undefined
        ? null
        : await this.database.userPrivacySettings.findUnique({
            where: { userId: authenticatedUserId },
            select: { productAnalyticsStatus: true },
          });

    const seenInThisBatch = new Set<string>();
    const results: EventOutcome[] = [];
    for (const event of batch.events) {
      results.push(
        await this.ingestOne(
          event,
          authenticatedUserId,
          privacySettings,
          seenInThisBatch,
        ),
      );
    }

    return { results, serverTime: new Date().toISOString() };
  }

  private async ingestOne(
    event: BatchEventInput,
    authenticatedUserId: string | undefined,
    privacySettings: { productAnalyticsStatus: ConsentStatus } | null,
    seenInThisBatch: Set<string>,
  ): Promise<EventOutcome> {
    if (seenInThisBatch.has(event.eventId)) {
      return {
        eventId: event.eventId,
        status: "DUPLICATE",
        rejectionCode: null,
      };
    }
    seenInThisBatch.add(event.eventId);

    const definition = findEventDefinition(
      event.eventName,
      event.schemaVersion,
    );
    if (definition === undefined) {
      return {
        eventId: event.eventId,
        status: "REJECTED",
        rejectionCode: "UNKNOWN_EVENT",
      };
    }

    const issue = propertyIssue(definition, event.properties);
    if (issue !== undefined) {
      return {
        eventId: event.eventId,
        status: "REJECTED",
        rejectionCode: "SCHEMA_MISMATCH",
      };
    }

    if (
      definition.consentCategory === "product_analytics" &&
      privacySettings?.productAnalyticsStatus === ConsentStatus.DENIED
    ) {
      return {
        eventId: event.eventId,
        status: "REJECTED",
        rejectionCode: "CONSENT_DENIED",
      };
    }

    const now = new Date();
    try {
      await this.database.analyticsOutboxEvent.create({
        data: {
          eventId: event.eventId,
          eventName: event.eventName,
          schemaVersion: event.schemaVersion,
          occurredAt: new Date(event.occurredAt),
          analyticsSubjectId: authenticatedUserId ?? null,
          anonymousId: event.anonymousId,
          properties: redact(event.properties),
          context: redact(event.context) as Prisma.InputJsonValue,
          consentCategory:
            definition.consentCategory === "essential_operations"
              ? ConsentCategory.DIAGNOSTICS
              : ConsentCategory.PRODUCT_ANALYTICS,
          expiresAt: new Date(now.getTime() + OUTBOX_TTL_MS),
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return {
          eventId: event.eventId,
          status: "DUPLICATE",
          rejectionCode: null,
        };
      }
      throw error;
    }

    return { eventId: event.eventId, status: "ACCEPTED", rejectionCode: null };
  }
}

function ajvErrors(errors: ErrorObject[] | null | undefined): string {
  if (errors === null || errors === undefined || errors.length === 0) {
    return "Analytics batch payload is invalid";
  }
  return errors
    .map((error) => `${error.instancePath || "(root)"} ${error.message ?? ""}`)
    .join("; ");
}
