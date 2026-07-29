import {
  canonicalLocale,
  exactRequestKeys,
  requestRecord,
  requiredString,
  validationError,
} from "../../common/http/request-validation";

export interface UpdateUserRequest {
  displayName?: string | null;
  preferredLocale?: string;
}

export function parseUpdateUserRequest(value: unknown): UpdateUserRequest {
  const body = requestRecord(value, "body");
  exactRequestKeys(body, ["displayName", "preferredLocale"], "body");
  if (Object.keys(body).length === 0) {
    validationError("body", "must contain at least one field");
  }

  const result: UpdateUserRequest = {};
  if ("displayName" in body) {
    result.displayName =
      body.displayName === null
        ? null
        : requiredString(body.displayName, "displayName", 1, 100).trim();
    if (result.displayName === "") {
      validationError("displayName", "must not contain only whitespace");
    }
  }
  if ("preferredLocale" in body) {
    result.preferredLocale = canonicalLocale(
      body.preferredLocale,
      "preferredLocale",
    );
  }
  return result;
}
