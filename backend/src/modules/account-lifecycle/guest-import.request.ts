import { createHash } from "node:crypto";

import { AnswerMode, ReviewRating } from "@prisma/client";

import {
  dateTime,
  exactRequestKeys,
  requestRecord,
  requiredString,
  uuid,
  validationError,
} from "../../common/http/request-validation";

export interface GuestSessionRequest {
  id: string;
  deckId: string;
  mode: "SELF_RATED" | "MULTIPLE_CHOICE";
  requestedUniqueCount: 5 | 10 | 20;
  contentVersion: string;
  startedAt: Date;
  completedAt: Date | null;
}

interface GuestReviewBase {
  id: string;
  sessionId: string;
  learningCardId: string;
  answerMode: "SELF_RATED" | "MULTIPLE_CHOICE";
  clientOccurredAt: Date;
  clientSequence: bigint;
  responseTimeMs: number | null;
}

export interface GuestSelfRatedReview extends GuestReviewBase {
  answerMode: "SELF_RATED";
  rating: ReviewRating;
}

export interface GuestMultipleChoiceReview extends GuestReviewBase {
  answerMode: "MULTIPLE_CHOICE";
  selectedOptionId: string;
  options: Array<{ id: string; answerEntityId: string }> | null;
}

export type GuestReviewRequest =
  | GuestSelfRatedReview
  | GuestMultipleChoiceReview;

export interface GuestImportRequest {
  payloadVersion: 1;
  migrationId: string;
  sourceInstallId: string;
  sessions: GuestSessionRequest[];
  reviews: GuestReviewRequest[];
}

function requiredField(
  record: Record<string, unknown>,
  field: string,
  context: string,
): unknown {
  if (!(field in record) || record[field] === undefined) {
    validationError(`${context}.${field}`, "is required");
  }
  return record[field];
}

function integer(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    validationError(field, `must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function session(value: unknown, index: number): GuestSessionRequest {
  const context = `sessions[${index}]`;
  const record = requestRecord(value, context);
  exactRequestKeys(
    record,
    [
      "id",
      "deckId",
      "mode",
      "requestedUniqueCount",
      "contentVersion",
      "startedAt",
      "completedAt",
    ],
    context,
  );
  const mode = requiredField(record, "mode", context);
  if (mode !== AnswerMode.SELF_RATED && mode !== AnswerMode.MULTIPLE_CHOICE) {
    validationError(`${context}.mode`, "must be a supported answer mode");
  }
  const count = requiredField(record, "requestedUniqueCount", context);
  if (count !== 5 && count !== 10 && count !== 20) {
    validationError(`${context}.requestedUniqueCount`, "must be 5, 10, or 20");
  }
  const startedAt = dateTime(
    requiredField(record, "startedAt", context),
    `${context}.startedAt`,
  );
  const completedAt =
    record.completedAt === undefined
      ? null
      : dateTime(record.completedAt, `${context}.completedAt`);
  if (completedAt !== null && completedAt.getTime() < startedAt.getTime()) {
    validationError(`${context}.completedAt`, "must not precede startedAt");
  }
  return {
    id: uuid(requiredField(record, "id", context), `${context}.id`),
    deckId: uuid(requiredField(record, "deckId", context), `${context}.deckId`),
    mode,
    requestedUniqueCount: count,
    contentVersion: requiredString(
      requiredField(record, "contentVersion", context),
      `${context}.contentVersion`,
      1,
      128,
    ),
    startedAt,
    completedAt,
  };
}

function review(value: unknown, index: number): GuestReviewRequest {
  const context = `reviews[${index}]`;
  const record = requestRecord(value, context);
  const mode = requiredField(record, "answerMode", context);
  const common = [
    "id",
    "sessionId",
    "learningCardId",
    "answerMode",
    "clientOccurredAt",
    "clientSequence",
    "responseTimeMs",
  ];
  if (mode === AnswerMode.SELF_RATED) {
    exactRequestKeys(record, [...common, "rating"], context);
  } else if (mode === AnswerMode.MULTIPLE_CHOICE) {
    exactRequestKeys(
      record,
      [...common, "selectedOptionId", "options"],
      context,
    );
  } else {
    validationError(`${context}.answerMode`, "must be a supported answer mode");
  }
  const base = {
    id: uuid(requiredField(record, "id", context), `${context}.id`),
    sessionId: uuid(
      requiredField(record, "sessionId", context),
      `${context}.sessionId`,
    ),
    learningCardId: uuid(
      requiredField(record, "learningCardId", context),
      `${context}.learningCardId`,
    ),
    clientOccurredAt: dateTime(
      requiredField(record, "clientOccurredAt", context),
      `${context}.clientOccurredAt`,
    ),
    clientSequence: BigInt(
      integer(
        requiredField(record, "clientSequence", context),
        `${context}.clientSequence`,
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    ),
    responseTimeMs:
      record.responseTimeMs === undefined
        ? null
        : integer(
            record.responseTimeMs,
            `${context}.responseTimeMs`,
            0,
            86_400_000,
          ),
  };
  if (mode === AnswerMode.SELF_RATED) {
    const rating = requiredField(record, "rating", context);
    if (
      typeof rating !== "string" ||
      !Object.values(ReviewRating).includes(rating as ReviewRating)
    ) {
      validationError(`${context}.rating`, "must be a review rating");
    }
    return { ...base, answerMode: mode, rating: rating as ReviewRating };
  }
  const options =
    record.options === undefined
      ? null
      : parseOptions(record.options, `${context}.options`);
  return {
    ...base,
    answerMode: AnswerMode.MULTIPLE_CHOICE,
    selectedOptionId: uuid(
      requiredField(record, "selectedOptionId", context),
      `${context}.selectedOptionId`,
    ),
    options,
  };
}

function parseOptions(
  value: unknown,
  context: string,
): Array<{ id: string; answerEntityId: string }> {
  if (!Array.isArray(value) || value.length !== 4) {
    validationError(context, "must contain exactly four options");
  }
  const options = value.map((entry, index) => {
    const item = requestRecord(entry, `${context}[${index}]`);
    exactRequestKeys(item, ["id", "answerEntityId"], `${context}[${index}]`);
    return {
      id: uuid(
        requiredField(item, "id", `${context}[${index}]`),
        `${context}[${index}].id`,
      ),
      answerEntityId: uuid(
        requiredField(item, "answerEntityId", `${context}[${index}]`),
        `${context}[${index}].answerEntityId`,
      ),
    };
  });
  if (
    new Set(options.map(({ id }) => id)).size !== options.length ||
    new Set(options.map(({ answerEntityId }) => answerEntityId)).size !==
      options.length
  ) {
    validationError(context, "must contain unique option and entity IDs");
  }
  return options;
}

export function parseGuestImportRequest(value: unknown): GuestImportRequest {
  const body = requestRecord(value, "body");
  exactRequestKeys(
    body,
    [
      "$schema",
      "payloadVersion",
      "migrationId",
      "sourceInstallId",
      "sessions",
      "reviews",
    ],
    "body",
  );
  if (body.payloadVersion !== 1) {
    validationError("payloadVersion", "must be 1");
  }
  if (!Array.isArray(body.sessions) || body.sessions.length > 100) {
    validationError("sessions", "must contain at most 100 items");
  }
  if (!Array.isArray(body.reviews) || body.reviews.length > 1_000) {
    validationError("reviews", "must contain at most 1000 items");
  }
  const parsed: GuestImportRequest = {
    payloadVersion: 1,
    migrationId: uuid(body.migrationId, "migrationId"),
    sourceInstallId: requiredString(
      body.sourceInstallId,
      "sourceInstallId",
      16,
      128,
    ),
    sessions: body.sessions.map(session),
    reviews: body.reviews.map(review),
  };
  if (
    new Set(parsed.sessions.map(({ id }) => id)).size !== parsed.sessions.length
  ) {
    validationError("sessions", "must contain unique IDs");
  }
  if (
    new Set(parsed.reviews.map(({ id }) => id)).size !== parsed.reviews.length
  ) {
    validationError("reviews", "must contain unique IDs");
  }
  const sessionById = new Map(parsed.sessions.map((item) => [item.id, item]));
  for (const [index, item] of parsed.reviews.entries()) {
    const parent = sessionById.get(item.sessionId);
    if (parent === undefined) {
      validationError(
        `reviews[${index}].sessionId`,
        "must reference a session in this import",
      );
    }
    if (parent.mode !== item.answerMode) {
      validationError(
        `reviews[${index}].answerMode`,
        "must match the referenced session mode",
      );
    }
  }
  for (const importedSession of parsed.sessions) {
    const uniqueCards = new Set(
      parsed.reviews
        .filter(({ sessionId }) => sessionId === importedSession.id)
        .map(({ learningCardId }) => learningCardId),
    );
    if (uniqueCards.size > importedSession.requestedUniqueCount) {
      validationError(
        "reviews",
        `session ${importedSession.id} exceeds requestedUniqueCount`,
      );
    }
  }
  return parsed;
}

export function guestImportRequestHash(request: GuestImportRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...request,
        sessions: request.sessions.map((item) => ({
          ...item,
          startedAt: item.startedAt.toISOString(),
          completedAt: item.completedAt?.toISOString() ?? null,
        })),
        reviews: request.reviews.map((item) => ({
          ...item,
          clientOccurredAt: item.clientOccurredAt.toISOString(),
          clientSequence: item.clientSequence.toString(),
        })),
      }),
    )
    .digest("hex");
}
