import { createHash } from "node:crypto";

import { BadRequestException } from "@nestjs/common";
import { AnswerMode, SelectionOrigin } from "@prisma/client";

import {
  dateTime,
  exactRequestKeys,
  requestRecord,
} from "../../common/http/request-validation";
import { parseLocale, parseUuid } from "../content/content-query";

export interface CompleteStudySessionRequest {
  completedAt: Date;
}

const COMPLETE_KEYS = ["completedAt"] as const;

export function parseCompleteStudySessionRequest(
  value: unknown,
): CompleteStudySessionRequest {
  const body = requestRecord(value, "body");
  exactRequestKeys(body, COMPLETE_KEYS, "body");

  return { completedAt: dateTime(body.completedAt, "body.completedAt") };
}

export interface CreateServerStudySessionRequest {
  id: string;
  deckId: string;
  requestedUniqueCount: 5 | 10 | 20;
  mode: typeof AnswerMode.SELF_RATED | typeof AnswerMode.MULTIPLE_CHOICE;
  locale: string;
  selectionOrigin: typeof SelectionOrigin.SERVER;
}

const REQUIRED_KEYS = [
  "id",
  "deckId",
  "requestedUniqueCount",
  "mode",
  "locale",
  "selectionOrigin",
] as const;

export function parseCreateStudySessionRequest(
  value: unknown,
): CreateServerStudySessionRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("Request body must be an object");
  }
  const body = value as Record<string, unknown>;
  const unknownKeys = Object.keys(body).filter(
    (key) => !REQUIRED_KEYS.includes(key as (typeof REQUIRED_KEYS)[number]),
  );
  if (unknownKeys.length > 0) {
    throw new BadRequestException(
      `Unknown request fields: ${unknownKeys.join(", ")}`,
    );
  }
  for (const key of REQUIRED_KEYS) {
    if (!(key in body)) {
      throw new BadRequestException(`Request field ${key} is required`);
    }
  }
  if (typeof body.id !== "string" || typeof body.deckId !== "string") {
    throw new BadRequestException("id and deckId must be UUID strings");
  }
  if (![5, 10, 20].includes(body.requestedUniqueCount as number)) {
    throw new BadRequestException("requestedUniqueCount must be 5, 10, or 20");
  }
  if (
    body.mode !== AnswerMode.SELF_RATED &&
    body.mode !== AnswerMode.MULTIPLE_CHOICE
  ) {
    throw new BadRequestException("mode must be SELF_RATED or MULTIPLE_CHOICE");
  }
  if (body.selectionOrigin !== SelectionOrigin.SERVER) {
    throw new BadRequestException(
      "Only SERVER session selection is supported in this increment",
    );
  }
  if (typeof body.locale !== "string") {
    throw new BadRequestException("locale must be a string");
  }

  return {
    id: parseUuid(body.id, "id"),
    deckId: parseUuid(body.deckId, "deckId"),
    requestedUniqueCount: body.requestedUniqueCount as 5 | 10 | 20,
    mode: body.mode,
    locale: parseLocale(body.locale),
    selectionOrigin: SelectionOrigin.SERVER,
  };
}

export function requestHash(request: CreateServerStudySessionRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: request.id,
        deckId: request.deckId,
        requestedUniqueCount: request.requestedUniqueCount,
        mode: request.mode,
        locale: request.locale.toLowerCase(),
        selectionOrigin: request.selectionOrigin,
      }),
    )
    .digest("hex");
}
