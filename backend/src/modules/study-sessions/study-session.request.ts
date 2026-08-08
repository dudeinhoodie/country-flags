import { createHash } from "node:crypto";

import { BadRequestException, HttpStatus } from "@nestjs/common";
import { AnswerMode, SelectionOrigin } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import {
  dateTime,
  exactRequestKeys,
  requestRecord,
  requiredString,
  uuid,
  validationError,
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

export interface OfflineStudySessionCardRequest {
  learningCardId: string;
  learningCardRevision: number;
  assetSha256: string;
  randomSeed: string;
}

export interface CreateOfflineStudySessionRequest {
  id: string;
  deckId: string;
  requestedUniqueCount: 5 | 10 | 20;
  mode: typeof AnswerMode.SELF_RATED;
  locale: string;
  selectionOrigin: typeof SelectionOrigin.CLIENT_OFFLINE;
  startedAt: Date;
  contentVersion: string;
  cards: OfflineStudySessionCardRequest[];
}

export type CreateStudySessionRequest =
  | CreateServerStudySessionRequest
  | CreateOfflineStudySessionRequest;

const REQUIRED_KEYS = [
  "id",
  "deckId",
  "requestedUniqueCount",
  "mode",
  "locale",
  "selectionOrigin",
] as const;

const OFFLINE_KEYS = [
  ...REQUIRED_KEYS,
  "startedAt",
  "contentVersion",
  "cards",
] as const;

const OFFLINE_CARD_KEYS = [
  "learningCardId",
  "learningCardRevision",
  "assetSha256",
  "randomSeed",
  "distractorPolicyVersion",
  "snapshot",
  "options",
] as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_UNIQUE_CARDS = 20;

/**
 * An offline composition cannot carry a canonical objective option set:
 * `StudyOption` has no answer entity identity, so the only way to grade a
 * submitted option would be to compare a localized display string, and
 * regenerating options server-side would invalidate the option IDs the device
 * already recorded in its pending reviews. See
 * `docs/adr/ADR-010-offline-study-session-import.md`.
 */
function offlineModeUnsupported(field: string): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    "OFFLINE_MODE_UNSUPPORTED",
    "Offline session import supports SELF_RATED only",
    { field, supportedModes: [AnswerMode.SELF_RATED] },
  );
}

function requestedUniqueCount(value: unknown, field: string): 5 | 10 | 20 {
  if (value === 5 || value === 10 || value === 20) {
    return value;
  }
  validationError(field, "must be 5, 10, or 20");
}

function positiveInteger(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 2_147_483_647
  ) {
    validationError(field, "must be a positive integer");
  }
  return value;
}

function parseOfflineCard(
  value: unknown,
  index: number,
): OfflineStudySessionCardRequest {
  const field = `body.cards[${index}]`;
  const card = requestRecord(value, field);
  exactRequestKeys(card, OFFLINE_CARD_KEYS, field);

  if (card.options !== undefined) {
    offlineModeUnsupported(`${field}.options`);
  }
  if (card.distractorPolicyVersion !== undefined) {
    if (card.distractorPolicyVersion !== null) {
      offlineModeUnsupported(`${field}.distractorPolicyVersion`);
    }
  }

  const learningCardId = uuid(card.learningCardId, `${field}.learningCardId`);
  const learningCardRevision = positiveInteger(
    card.learningCardRevision,
    `${field}.learningCardRevision`,
  );

  // The submitted snapshot is never persisted: the server rebuilds it from the
  // declared revision. Only the identity it claims has to agree, so a client
  // cannot pin one card and render another.
  const snapshot = requestRecord(card.snapshot, `${field}.snapshot`);
  if (uuid(snapshot.id, `${field}.snapshot.id`) !== learningCardId) {
    validationError(`${field}.snapshot.id`, "must equal learningCardId");
  }
  if (snapshot.revision !== learningCardRevision) {
    validationError(
      `${field}.snapshot.revision`,
      "must equal learningCardRevision",
    );
  }

  return {
    learningCardId,
    learningCardRevision,
    assetSha256: requiredString(
      card.assetSha256,
      `${field}.assetSha256`,
      64,
      64,
      SHA256_PATTERN,
    ),
    randomSeed: requiredString(card.randomSeed, `${field}.randomSeed`, 1, 128),
  };
}

function parseCreateOfflineStudySessionRequest(
  body: Record<string, unknown>,
): CreateOfflineStudySessionRequest {
  exactRequestKeys(body, OFFLINE_KEYS, "body");
  for (const key of OFFLINE_KEYS) {
    if (!(key in body)) {
      validationError(`body.${key}`, "is required");
    }
  }
  if (body.mode === AnswerMode.MULTIPLE_CHOICE) {
    offlineModeUnsupported("body.mode");
  }
  if (body.mode !== AnswerMode.SELF_RATED) {
    validationError("body.mode", "must be SELF_RATED");
  }

  const locale = body.locale;
  if (typeof locale !== "string") {
    validationError("body.locale", "must be a BCP 47 locale");
  }
  const count = requestedUniqueCount(
    body.requestedUniqueCount,
    "body.requestedUniqueCount",
  );
  const rawCards = body.cards;
  if (
    !Array.isArray(rawCards) ||
    rawCards.length < 1 ||
    rawCards.length > MAX_UNIQUE_CARDS
  ) {
    validationError(
      "body.cards",
      `must contain between 1 and ${MAX_UNIQUE_CARDS} items`,
    );
  }
  if (rawCards.length > count) {
    validationError("body.cards", "must not exceed requestedUniqueCount");
  }

  const cards = rawCards.map(parseOfflineCard);
  const distinct = new Set(cards.map((card) => card.learningCardId));
  if (distinct.size !== cards.length) {
    validationError("body.cards", "must not repeat a learningCardId");
  }

  return {
    id: uuid(body.id, "body.id"),
    deckId: uuid(body.deckId, "body.deckId"),
    requestedUniqueCount: count,
    mode: AnswerMode.SELF_RATED,
    locale: parseLocale(locale),
    selectionOrigin: SelectionOrigin.CLIENT_OFFLINE,
    startedAt: dateTime(body.startedAt, "body.startedAt"),
    contentVersion: requiredString(
      body.contentVersion,
      "body.contentVersion",
      1,
      128,
    ),
    cards,
  };
}

export function parseCreateStudySessionRequest(
  value: unknown,
): CreateStudySessionRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("Request body must be an object");
  }
  const body = value as Record<string, unknown>;
  if (body.selectionOrigin === SelectionOrigin.CLIENT_OFFLINE) {
    return parseCreateOfflineStudySessionRequest(body);
  }

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
      "selectionOrigin must be SERVER or CLIENT_OFFLINE",
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

/**
 * Idempotency key for `(userId, sessionId)`. It covers the normalized
 * composition the server would create, not the raw body, so a retry that only
 * differs in a field the server rebuilds still resolves to the stored session.
 */
export function requestHash(request: CreateStudySessionRequest): string {
  const canonical =
    request.selectionOrigin === SelectionOrigin.SERVER
      ? {
          id: request.id,
          deckId: request.deckId,
          requestedUniqueCount: request.requestedUniqueCount,
          mode: request.mode,
          locale: request.locale.toLowerCase(),
          selectionOrigin: request.selectionOrigin,
        }
      : {
          id: request.id,
          deckId: request.deckId,
          requestedUniqueCount: request.requestedUniqueCount,
          mode: request.mode,
          locale: request.locale.toLowerCase(),
          selectionOrigin: request.selectionOrigin,
          startedAt: request.startedAt.toISOString(),
          contentVersion: request.contentVersion,
          cards: request.cards.map((card) => ({
            learningCardId: card.learningCardId,
            learningCardRevision: card.learningCardRevision,
            assetSha256: card.assetSha256,
            randomSeed: card.randomSeed,
          })),
        };

  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
