import { AnswerMode, FactType } from "@prisma/client";

import {
  canonicalLocale,
  exactRequestKeys,
  requestRecord,
  validationError,
  timeZone,
} from "../../common/http/request-validation";

const FACT_TYPES = [
  FactType.POPULATION,
  FactType.CAPITAL,
  FactType.AREA,
  FactType.LANGUAGE,
  FactType.CURRENCY,
] as const;

export interface UpdateSettingsRequest {
  sessionSize?: 5 | 10 | 20;
  contentLocale?: string;
  defaultAnswerMode?: "SELF_RATED" | "MULTIPLE_CHOICE";
  extraFactTypes?: FactType[];
  soundEnabled?: boolean;
  hapticsEnabled?: boolean;
  remindersEnabled?: boolean;
  reminderLocalTime?: Date | null;
  reminderWeekdays?: number[];
  desiredRetention?: number;
  timezone?: string;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    validationError(field, "must be a boolean");
  }
  return value;
}

function sessionSize(value: unknown): 5 | 10 | 20 {
  if (value !== 5 && value !== 10 && value !== 20) {
    validationError("sessionSize", "must be 5, 10, or 20");
  }
  return value;
}

function answerMode(
  value: unknown,
): typeof AnswerMode.SELF_RATED | typeof AnswerMode.MULTIPLE_CHOICE {
  if (value !== AnswerMode.SELF_RATED && value !== AnswerMode.MULTIPLE_CHOICE) {
    validationError(
      "defaultAnswerMode",
      "must be SELF_RATED or MULTIPLE_CHOICE",
    );
  }
  return value;
}

function extraFactTypes(value: unknown): FactType[] {
  if (!Array.isArray(value)) {
    validationError("extraFactTypes", "must be an array");
  }
  const parsed = value.map((entry, index) => {
    if (
      typeof entry !== "string" ||
      !FACT_TYPES.includes(entry as (typeof FACT_TYPES)[number])
    ) {
      validationError(
        `extraFactTypes[${index}]`,
        "must be an approved fact type",
      );
    }
    return entry as FactType;
  });
  if (new Set(parsed).size !== parsed.length) {
    validationError("extraFactTypes", "must contain unique values");
  }
  return parsed.sort(
    (left, right) =>
      FACT_TYPES.indexOf(left as (typeof FACT_TYPES)[number]) -
      FACT_TYPES.indexOf(right as (typeof FACT_TYPES)[number]),
  );
}

function reminderTime(value: unknown): Date | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)
  ) {
    validationError("reminderLocalTime", "must use HH:mm");
  }
  return new Date(`1970-01-01T${value}:00.000Z`);
}

function weekdays(value: unknown): number[] {
  if (value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    validationError("reminderWeekdays", "must be an array or null");
  }
  const parsed = value.map((entry, index) => {
    if (
      typeof entry !== "number" ||
      !Number.isInteger(entry) ||
      entry < 1 ||
      entry > 7
    ) {
      validationError(
        `reminderWeekdays[${index}]`,
        "must be an integer from 1 to 7",
      );
    }
    return entry;
  });
  if (new Set(parsed).size !== parsed.length) {
    validationError("reminderWeekdays", "must contain unique values");
  }
  return parsed.sort((left, right) => left - right);
}

function retention(value: unknown): number {
  if (typeof value !== "number" || value < 0.7 || value > 0.99) {
    validationError("desiredRetention", "must be from 0.7 to 0.99");
  }
  return value;
}

export function parseSettingsVersion(value: string | undefined): number {
  const match = /^W\/"([0-9]+)"$/.exec(value ?? "");
  const version = match?.[1] === undefined ? NaN : Number(match[1]);
  if (!Number.isSafeInteger(version) || version < 1) {
    validationError("If-Match", 'must use a settings ETag such as W/"4"');
  }
  return version;
}

export function parseUpdateSettingsRequest(
  value: unknown,
): UpdateSettingsRequest {
  const body = requestRecord(value, "body");
  const fields = [
    "sessionSize",
    "contentLocale",
    "defaultAnswerMode",
    "extraFactTypes",
    "soundEnabled",
    "hapticsEnabled",
    "remindersEnabled",
    "reminderLocalTime",
    "reminderWeekdays",
    "desiredRetention",
    "timezone",
  ] as const;
  exactRequestKeys(body, fields, "body");
  if (Object.keys(body).length === 0) {
    validationError("body", "must contain at least one field");
  }

  const update: UpdateSettingsRequest = {};
  if ("sessionSize" in body) {
    update.sessionSize = sessionSize(body.sessionSize);
  }
  if ("contentLocale" in body) {
    update.contentLocale = canonicalLocale(body.contentLocale, "contentLocale");
  }
  if ("defaultAnswerMode" in body) {
    update.defaultAnswerMode = answerMode(body.defaultAnswerMode);
  }
  if ("extraFactTypes" in body) {
    update.extraFactTypes = extraFactTypes(body.extraFactTypes);
  }
  for (const field of [
    "soundEnabled",
    "hapticsEnabled",
    "remindersEnabled",
  ] as const) {
    if (field in body) {
      update[field] = boolean(body[field], field);
    }
  }
  if ("reminderLocalTime" in body) {
    update.reminderLocalTime = reminderTime(body.reminderLocalTime);
  }
  if ("reminderWeekdays" in body) {
    update.reminderWeekdays = weekdays(body.reminderWeekdays);
  }
  if ("desiredRetention" in body) {
    update.desiredRetention = retention(body.desiredRetention);
  }
  if ("timezone" in body) {
    update.timezone = timeZone(body.timezone, "timezone");
  }
  return update;
}
