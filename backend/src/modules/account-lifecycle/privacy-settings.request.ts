import { ConsentStatus } from "@prisma/client";

import {
  exactRequestKeys,
  requestRecord,
  requiredString,
  validationError,
} from "../../common/http/request-validation";

export interface UpdatePrivacySettingsRequest {
  productAnalyticsStatus?: ConsentStatus;
  diagnosticsStatus?: ConsentStatus;
  policyVersion?: string;
}

function consentStatus(value: unknown, field: string): ConsentStatus {
  if (
    value !== ConsentStatus.UNKNOWN &&
    value !== ConsentStatus.GRANTED &&
    value !== ConsentStatus.DENIED &&
    value !== ConsentStatus.NOT_REQUIRED
  ) {
    validationError(field, "must be UNKNOWN, GRANTED, DENIED, or NOT_REQUIRED");
  }
  return value;
}

export function parsePrivacySettingsVersion(value: string | undefined): number {
  const match = /^W\/"([0-9]+)"$/.exec(value ?? "");
  const version = match?.[1] === undefined ? NaN : Number(match[1]);
  if (!Number.isSafeInteger(version) || version < 1) {
    validationError(
      "If-Match",
      'must use a privacy settings ETag such as W/"1"',
    );
  }
  return version;
}

export function parseUpdatePrivacySettingsRequest(
  value: unknown,
): UpdatePrivacySettingsRequest {
  const body = requestRecord(value, "body");
  const fields = [
    "productAnalyticsStatus",
    "diagnosticsStatus",
    "policyVersion",
  ] as const;
  exactRequestKeys(body, fields, "body");
  if (Object.keys(body).length === 0) {
    validationError("body", "must contain at least one field");
  }

  const update: UpdatePrivacySettingsRequest = {};
  if ("productAnalyticsStatus" in body) {
    update.productAnalyticsStatus = consentStatus(
      body.productAnalyticsStatus,
      "productAnalyticsStatus",
    );
  }
  if ("diagnosticsStatus" in body) {
    update.diagnosticsStatus = consentStatus(
      body.diagnosticsStatus,
      "diagnosticsStatus",
    );
  }
  if ("policyVersion" in body) {
    update.policyVersion = requiredString(
      body.policyVersion,
      "policyVersion",
      1,
      64,
    );
  }
  return update;
}
