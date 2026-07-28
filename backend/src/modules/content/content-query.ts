import { BadRequestException } from "@nestjs/common";

const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseLocale(value: string | undefined): string {
  if (value === undefined || !LOCALE_PATTERN.test(value)) {
    throw new BadRequestException("locale must be a valid BCP 47 locale");
  }

  return value;
}

export function parseLimit(value: string | undefined): number {
  if (value === undefined) {
    return 50;
  }

  if (!/^[0-9]+$/u.test(value)) {
    throw new BadRequestException("limit must be an integer from 1 to 100");
  }

  const limit = Number(value);
  if (limit < 1 || limit > 100) {
    throw new BadRequestException("limit must be an integer from 1 to 100");
  }

  return limit;
}

export function parseUuid(value: string, parameter: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new BadRequestException(`${parameter} must be a UUID`);
  }

  return value;
}

export function localeCandidates(
  requestedLocale: string,
  defaultLocale: string,
): string[] {
  const normalized = requestedLocale.toLowerCase();
  return [
    normalized,
    normalized.split("-")[0]!,
    defaultLocale.toLowerCase(),
  ].filter((locale, index, locales) => locales.indexOf(locale) === index);
}
