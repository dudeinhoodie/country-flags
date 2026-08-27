import { validationError } from "../../common/http/request-validation";

interface DeckCursor {
  kind: "deck";
  code: string;
}

/// A deck's cards are read in the reader's alphabet (#267), so the cursor
/// carries the name it stopped at rather than the membership's own order.
/// `sortName` is the name lowercased, which is what the query sorts on.
interface CardCursor {
  kind: "card";
  sortName: string;
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

/// A cursor that cannot be read at all. The client that hits this is
/// usually holding one it stored against a release that no longer exists,
/// which is exactly the moment it needs to be told that asking without a
/// cursor starts the list over.
const UNREADABLE = "cannot be read; omit it to start from the beginning";

function decode(field: string, value: string): unknown {
  if (value.length === 0 || value.length > 512) {
    validationError(field, UNREADABLE);
  }

  try {
    return JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;
  } catch {
    validationError(field, UNREADABLE);
  }
}

export function encodeDeckCursor(code: string): string {
  return encode({ kind: "deck", code });
}

export function decodeDeckCursor(value: string): DeckCursor {
  const cursor = decode("cursor", value);
  if (
    typeof cursor !== "object" ||
    cursor === null ||
    !("kind" in cursor) ||
    cursor.kind !== "deck" ||
    !("code" in cursor) ||
    typeof cursor.code !== "string" ||
    cursor.code.length === 0
  ) {
    validationError(
      "cursor",
      "belongs to another list; omit it to start from the beginning",
    );
  }

  return { kind: "deck", code: cursor.code };
}

export function encodeCardCursor(
  sortName: string,
  learningCardId: string,
): string {
  return encode({ kind: "card", sortName, learningCardId });
}

export function decodeCardCursor(value: string): CardCursor {
  const cursor = decode("cursor", value);
  if (
    typeof cursor !== "object" ||
    cursor === null ||
    !("kind" in cursor) ||
    cursor.kind !== "card" ||
    !("sortName" in cursor) ||
    typeof cursor.sortName !== "string" ||
    !("learningCardId" in cursor) ||
    typeof cursor.learningCardId !== "string"
  ) {
    validationError(
      "cursor",
      "belongs to another list; omit it to start from the beginning",
    );
  }

  return {
    kind: "card",
    sortName: cursor.sortName,
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
  // The manifests published so far hand out their initial cursor in a plain
  // legacy form, `content:<version>:<sequence>`, and clients have stored it.
  // Refusing it would strand every installed client of those releases on a
  // feed they can never read, so the legacy form stays accepted for as long
  // as such a release can be current. The canonical form below is what the
  // feed itself returns.
  const legacy = /^content:(?<version>.+):(?<sequence>0|[1-9][0-9]*)$/u.exec(
    value,
  );
  const version = legacy?.groups?.version;
  const sequence = legacy?.groups?.sequence;
  if (version !== undefined && sequence !== undefined) {
    return { version, sequence: BigInt(sequence) };
  }

  const cursor = decode("after", value);
  if (
    typeof cursor !== "object" ||
    cursor === null ||
    !("version" in cursor) ||
    typeof cursor.version !== "string" ||
    cursor.version.length === 0 ||
    !("sequence" in cursor) ||
    (typeof cursor.sequence !== "string" && typeof cursor.sequence !== "number")
  ) {
    validationError(
      "after",
      "does not belong to the content change feed; ask for the manifest again for a fresh one",
    );
  }

  const sequenceValue = cursor.sequence;
  if (
    (typeof sequenceValue === "string" &&
      !/^(?:0|[1-9][0-9]*)$/u.test(sequenceValue)) ||
    (typeof sequenceValue === "number" &&
      (!Number.isSafeInteger(sequenceValue) || sequenceValue < 0))
  ) {
    validationError(
      "after",
      "does not belong to the content change feed; ask for the manifest again for a fresh one",
    );
  }

  return {
    version: cursor.version,
    sequence: BigInt(sequenceValue),
  };
}
