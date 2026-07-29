import { HttpStatus } from "@nestjs/common";

import { ApiException } from "./api.exception";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validationError(field: string, message: string): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    "VALIDATION_FAILED",
    "One or more fields are invalid",
    { fields: [{ field, message }] },
  );
}

export function requestRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    validationError(field, "must be an object");
  }
  return value as Record<string, unknown>;
}

export function exactRequestKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    validationError(`${field}.${unexpected}`, "is not allowed");
  }
}

export function requiredString(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  pattern?: RegExp,
): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    validationError(
      field,
      `must be a valid string from ${minimum} to ${maximum} characters`,
    );
  }
  return value;
}

export function uuid(value: unknown, field: string): string {
  return requiredString(value, field, 36, 36, UUID_PATTERN).toLowerCase();
}

export function dateTime(value: unknown, field: string): Date {
  const raw = requiredString(value, field, 20, 40);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    validationError(field, "must be an RFC 3339 date-time");
  }
  return parsed;
}

export function canonicalLocale(value: unknown, field: string): string {
  const raw = requiredString(
    value,
    field,
    2,
    32,
    /^[a-zA-Z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/,
  );
  try {
    const canonical = Intl.getCanonicalLocales(raw)[0];
    if (canonical === undefined) {
      validationError(field, "must be a BCP 47 locale");
    }
    return canonical;
  } catch {
    validationError(field, "must be a BCP 47 locale");
  }
}

export function timeZone(value: unknown, field: string): string {
  const raw = requiredString(value, field, 1, 64);
  try {
    new Intl.DateTimeFormat("en", { timeZone: raw }).format();
    return raw;
  } catch {
    validationError(field, "must be an IANA time zone");
  }
}
