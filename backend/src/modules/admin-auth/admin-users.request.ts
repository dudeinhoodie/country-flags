import { AdminRole, AdminUserStatus } from "@prisma/client";

import {
  exactRequestKeys,
  requestRecord,
  validationError,
} from "../../common/http/request-validation";

export interface AdminListQuery {
  offset: number;
  limit: number;
}

function integerParameter(
  value: unknown,
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    validationError(
      field,
      `must be an integer from ${String(minimum)} to ${String(maximum)}`,
    );
  }
  return parsed;
}

export function parseAdminListQuery(query: unknown): AdminListQuery {
  const record =
    typeof query === "object" && query !== null && !Array.isArray(query)
      ? (query as Record<string, unknown>)
      : {};
  return {
    offset: integerParameter(record.offset, "offset", 0, 0, 1_000_000),
    limit: integerParameter(record.limit, "limit", 25, 1, 100),
  };
}

export interface AdminUserUpdateRequest {
  role?: AdminRole;
  status?: AdminUserStatus;
}

function enumValue<T extends Record<string, string>>(
  enumeration: T,
  value: unknown,
  field: string,
): T[keyof T] {
  const values = Object.values(enumeration);
  if (typeof value !== "string" || !values.includes(value)) {
    validationError(field, `must be one of: ${values.join(", ")}`);
  }
  return value as T[keyof T];
}

export function parseAdminUserUpdateRequest(
  body: unknown,
): AdminUserUpdateRequest {
  const root = requestRecord(body, "body");
  exactRequestKeys(root, ["role", "status"], "body");
  const update: AdminUserUpdateRequest = {};
  if (root.role !== undefined) {
    update.role = enumValue(AdminRole, root.role, "role");
  }
  if (root.status !== undefined) {
    update.status = enumValue(AdminUserStatus, root.status, "status");
  }
  if (update.role === undefined && update.status === undefined) {
    validationError("body", "must contain role or status");
  }
  return update;
}
