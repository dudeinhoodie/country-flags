import { createHash } from "node:crypto";

import { UnprocessableEntityException } from "@nestjs/common";
import { AnswerMode, ReviewRating } from "@prisma/client";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const COMMON_FIELDS = [
  "id",
  "sessionId",
  "learningCardId",
  "deviceId",
  "answerMode",
  "responseTimeMs",
  "clientOccurredAt",
  "estimatedServerOccurredAt",
  "clientSequence",
  "baseStateVersion",
] as const;

export interface ReviewEventBase {
  id: string;
  sessionId: string;
  learningCardId: string;
  deviceId: string;
  answerMode: "SELF_RATED" | "MULTIPLE_CHOICE";
  responseTimeMs: number | null;
  clientOccurredAt: Date;
  estimatedServerOccurredAt: Date | null;
  clientSequence: bigint;
  baseStateVersion: number | null;
}

export interface SelfRatedReviewEvent extends ReviewEventBase {
  answerMode: "SELF_RATED";
  rating: ReviewRating;
}

export interface MultipleChoiceReviewEvent extends ReviewEventBase {
  answerMode: "MULTIPLE_CHOICE";
  selectedOptionId: string;
}

export type ReviewEventRequest =
  | SelfRatedReviewEvent
  | MultipleChoiceReviewEvent;

export interface ReviewBatchRequest {
  payloadVersion: 1;
  events: ReviewEventRequest[];
}

function validationError(message: string): never {
  throw new UnprocessableEntityException(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  context: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    validationError(`${context} contains unknown field ${unknown[0]}`);
  }
  const missing = required.filter(
    (key) => !(key in value) || value[key] === undefined,
  );
  if (missing.length > 0) {
    validationError(`${context} requires field ${missing[0]}`);
  }
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    validationError(`${field} must be a UUID`);
  }
  return value.toLowerCase();
}

function date(value: unknown, field: string): Date {
  if (typeof value !== "string") {
    validationError(`${field} must be an RFC 3339 date-time`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    validationError(`${field} must be an RFC 3339 date-time`);
  }
  return parsed;
}

function nullableDate(value: unknown, field: string): Date | null {
  return value === undefined || value === null ? null : date(value, field);
}

function nullableInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    validationError(
      `${field} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function positiveSequence(value: unknown): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    validationError("clientSequence must be a positive safe integer");
  }
  return BigInt(value);
}

function commonFields(
  value: Record<string, unknown>,
  answerMode: ReviewEventBase["answerMode"],
): ReviewEventBase {
  return {
    id: uuid(value.id, "id"),
    sessionId: uuid(value.sessionId, "sessionId"),
    learningCardId: uuid(value.learningCardId, "learningCardId"),
    deviceId: uuid(value.deviceId, "deviceId"),
    answerMode,
    responseTimeMs: nullableInteger(
      value.responseTimeMs,
      "responseTimeMs",
      0,
      86_400_000,
    ),
    clientOccurredAt: date(value.clientOccurredAt, "clientOccurredAt"),
    estimatedServerOccurredAt: nullableDate(
      value.estimatedServerOccurredAt,
      "estimatedServerOccurredAt",
    ),
    clientSequence: positiveSequence(value.clientSequence),
    baseStateVersion: nullableInteger(
      value.baseStateVersion,
      "baseStateVersion",
      0,
      2_147_483_647,
    ),
  };
}

function parseEvent(value: unknown, index: number): ReviewEventRequest {
  if (!isRecord(value)) {
    validationError(`events[${index}] must be an object`);
  }
  if (value.answerMode === AnswerMode.SELF_RATED) {
    const allowed = [...COMMON_FIELDS, "rating"];
    assertExactFields(
      value,
      allowed,
      [
        "id",
        "sessionId",
        "learningCardId",
        "deviceId",
        "answerMode",
        "rating",
        "clientOccurredAt",
        "clientSequence",
      ],
      `events[${index}]`,
    );
    if (
      typeof value.rating !== "string" ||
      !Object.values(ReviewRating).includes(value.rating as ReviewRating)
    ) {
      validationError(`events[${index}].rating is invalid`);
    }
    return {
      ...commonFields(value, AnswerMode.SELF_RATED),
      answerMode: AnswerMode.SELF_RATED,
      rating: value.rating as ReviewRating,
    };
  }
  if (value.answerMode === AnswerMode.MULTIPLE_CHOICE) {
    const allowed = [...COMMON_FIELDS, "selectedOptionId"];
    assertExactFields(
      value,
      allowed,
      [
        "id",
        "sessionId",
        "learningCardId",
        "deviceId",
        "answerMode",
        "selectedOptionId",
        "clientOccurredAt",
        "clientSequence",
      ],
      `events[${index}]`,
    );
    return {
      ...commonFields(value, AnswerMode.MULTIPLE_CHOICE),
      answerMode: AnswerMode.MULTIPLE_CHOICE,
      selectedOptionId: uuid(
        value.selectedOptionId,
        `events[${index}].selectedOptionId`,
      ),
    };
  }
  validationError(`events[${index}].answerMode is not supported`);
}

export function parseReviewBatchRequest(value: unknown): ReviewBatchRequest {
  if (!isRecord(value)) {
    validationError("Review batch must be an object");
  }
  assertExactFields(
    value,
    ["payloadVersion", "events"],
    ["payloadVersion", "events"],
    "Review batch",
  );
  if (value.payloadVersion !== 1) {
    validationError("payloadVersion must be 1");
  }
  if (
    !Array.isArray(value.events) ||
    value.events.length < 1 ||
    value.events.length > 500
  ) {
    validationError("events must contain between 1 and 500 items");
  }
  return {
    payloadVersion: 1,
    events: value.events.map(parseEvent),
  };
}

function canonicalValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function reviewPayloadHash(
  payloadVersion: number,
  event: ReviewEventRequest,
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue({ payloadVersion, event })))
    .digest("hex");
}
