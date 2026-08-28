import { validationError } from "../../common/http/request-validation";

/// A cursor this scope cannot read — unreadable, or issued to somebody
/// else. Either way the client is holding one it can no longer use, and the
/// way out is the same.
const UNREADABLE = "cannot be read; omit it to start from the beginning";

interface SequenceCursor {
  kind: "user-change";
  scopeId: string;
  sequence: string;
}

function encode(cursor: SequenceCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decode(
  value: string,
  expectedKind: SequenceCursor["kind"],
  expectedScopeId: string,
): bigint {
  if (value.length === 0 || value.length > 512) {
    validationError("cursor", UNREADABLE);
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("kind" in decoded) ||
      decoded.kind !== expectedKind ||
      !("sequence" in decoded) ||
      typeof decoded.sequence !== "string" ||
      !/^(0|[1-9][0-9]*)$/u.test(decoded.sequence) ||
      !("scopeId" in decoded) ||
      decoded.scopeId !== expectedScopeId
    ) {
      throw new Error("invalid sequence cursor");
    }
    return BigInt(decoded.sequence);
  } catch {
    validationError("cursor", UNREADABLE);
  }
}

export function encodeUserChangeCursor(
  scopeId: string,
  sequence: bigint,
): string {
  return encode({
    kind: "user-change",
    scopeId,
    sequence: sequence.toString(),
  });
}

export function decodeUserChangeCursor(
  value: string,
  expectedScopeId: string,
): bigint {
  return decode(value, "user-change", expectedScopeId);
}
