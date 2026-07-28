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

type ContentCursor = DeckCursor | CardCursor;

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
