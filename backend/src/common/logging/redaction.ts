const REDACTED = "[REDACTED]";
const MAX_DEPTH = 12;

/** Key names that must never appear with their real value in logs, traces, or error reports. */
const KEY_DENYLIST =
  /token|password|secret|authoriz|cookie|email|providersubject|pushtoken|idfa|advertisingid/i;

// Real JWT segments are base64url-encoded JSON/HMAC bytes and are always well
// over 10 characters each, even for a minimal token — long enough to not
// collide with short dotted identifiers like semver ("1.0.0") or hostnames.
const JWT_PATTERN =
  /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;
const BEARER_PATTERN = /^bearer\s+\S+/i;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function redactString(value: string): string {
  if (JWT_PATTERN.test(value) || BEARER_PATTERN.test(value)) {
    return REDACTED;
  }
  return value.replace(EMAIL_PATTERN, REDACTED);
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth >= MAX_DEPTH) {
    return REDACTED;
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    return redactObject(value as Record<string, unknown>, depth);
  }
  return value;
}

function redactObject(
  value: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      KEY_DENYLIST.test(key) ? REDACTED : redactValue(entryValue, depth + 1),
    ]),
  );
}

/**
 * Denylist-based PII/secret scrubber applied to every log entry before it is
 * written. Redacts by key name (token/password/email/... fields) and by
 * value shape (JWTs, `Bearer ...` headers, embedded email addresses) so a
 * caller cannot accidentally leak a secret through an unexpected field name.
 */
export function redact<T>(value: T): T {
  return redactValue(value, 0) as T;
}
