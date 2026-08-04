import { BadRequestException } from "@nestjs/common";

interface DeckCursor {
  kind: "deck";
  code: string;
}

interface CardCursor {
  kind: "card";
  sortOrder: number | null;
  learningCardId: string;
}

interface ContentChangeCursor {
  version: string;
  sequence: bigint;
}

type EncodedContentChangeCursor = {
  version: string;
  sequence: string;
};

type ContentCursor = DeckCursor | CardCursor | EncodedContentChangeCursor;

function encode(payload: ContentCursor): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decode(value: string): unknown {
  if (value.length === 0 || value.length > 512) {
    throw new BadRequestException("cursor is invalid");
  }

  try {
    return JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;
  } catch {
    throw new BadRequestException("cursor is invalid");
  }
}

export function encodeDeckCursor(code: string): string {
  return encode({ kind: "deck", code });
}

export function decodeDeckCursor(value: string): DeckCursor {
  const cursor = decode(value);
  if (
    typeof cursor !== "object" ||
    cursor === null ||
    !("kind" in cursor) ||
    cursor.kind !== "deck" ||
    !("code" in cursor) ||
    typeof cursor.code !== "string" ||
    cursor.code.length === 0
  ) {
    throw new BadRequestException("cursor does not belong to the deck list");
  }

  return { kind: "deck", code: cursor.code };
}

export function encodeCardCursor(
  sortOrder: number | null,
  learningCardId: string,
): string {
  return encode({ kind: "card", sortOrder, learningCardId });
}

export function decodeCardCursor(value: string): CardCursor {
  const cursor = decode(value);
  if (
    typeof cursor !== "object" ||
    cursor === null ||
    !("kind" in cursor) ||
    cursor.kind !== "card" ||
    !("sortOrder" in cursor) ||
    (cursor.sortOrder !== null &&
      (typeof cursor.sortOrder !== "number" ||
        !Number.isInteger(cursor.sortOrder))) ||
    !("learningCardId" in cursor) ||
    typeof cursor.learningCardId !== "string"
  ) {
    throw new BadRequestException("cursor does not belong to the card list");
  }

  return {
    kind: "card",
    sortOrder: cursor.sortOrder,
    learningCardId: cursor.learningCardId,
  };
}

export function encodeContentChangeCursor(
  version: string,
  sequence: bigint,
): string {
  return encode({ version, sequence: sequence.toString() });
}

export function decodeContentChangeCursor(value: string): ContentChangeCursor {
  const cursor = decode(value);
  if (
    typeof cursor !== "object" ||
    cursor === null ||
    !("version" in cursor) ||
    typeof cursor.version !== "string" ||
    cursor.version.length === 0 ||
    !("sequence" in cursor) ||
    (typeof cursor.sequence !== "string" && typeof cursor.sequence !== "number")
  ) {
    throw new BadRequestException(
      "cursor does not belong to the content change feed",
    );
  }

  const sequenceValue = cursor.sequence;
  if (
    (typeof sequenceValue === "string" &&
      !/^(?:0|[1-9][0-9]*)$/u.test(sequenceValue)) ||
    (typeof sequenceValue === "number" &&
      (!Number.isSafeInteger(sequenceValue) || sequenceValue < 0))
  ) {
    throw new BadRequestException(
      "cursor does not belong to the content change feed",
    );
  }

  return {
    version: cursor.version,
    sequence: BigInt(sequenceValue),
  };
}
