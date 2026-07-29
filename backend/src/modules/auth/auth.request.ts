import { HttpStatus } from "@nestjs/common";
import { ClientPlatform } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";

export interface DeviceRegistration {
  clientGeneratedId: string;
  platform: ClientPlatform;
  appVersion: string;
  locale: string;
  timezone: string;
}

export interface AppleCredential {
  identityToken: string;
  authorizationCode: string;
  rawNonce: string;
}

export interface AppleAuthRequest extends AppleCredential {
  device: DeviceRegistration;
}

export interface GoogleCredential {
  idToken: string;
}

export interface GoogleAuthRequest extends GoogleCredential {
  device: DeviceRegistration;
}

function invalid(field: string, message: string): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    "VALIDATION_FAILED",
    "One or more fields are invalid",
    { fields: [{ field, message }] },
  );
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(field, "must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    invalid(`${field}.${unexpected}`, "is not allowed");
  }
}

function string(
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
    invalid(
      field,
      `must be a valid string from ${minimum} to ${maximum} characters`,
    );
  }
  return value;
}

function parseDevice(value: unknown): DeviceRegistration {
  const device = record(value, "device");
  exactKeys(
    device,
    ["clientGeneratedId", "platform", "appVersion", "locale", "timezone"],
    "device",
  );
  const platform = string(device.platform, "device.platform", 3, 16);
  if (!Object.values(ClientPlatform).includes(platform as ClientPlatform)) {
    invalid("device.platform", "must be IOS, ANDROID, or WEB");
  }

  return {
    clientGeneratedId: string(
      device.clientGeneratedId,
      "device.clientGeneratedId",
      16,
      128,
    ),
    platform: platform as ClientPlatform,
    appVersion: string(
      device.appVersion,
      "device.appVersion",
      5,
      32,
      /^\d+\.\d+\.\d+$/,
    ),
    locale: string(
      device.locale,
      "device.locale",
      2,
      32,
      /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/,
    ),
    timezone: string(device.timezone, "device.timezone", 1, 64),
  };
}

export function parseAppleAuthRequest(value: unknown): AppleAuthRequest {
  const body = record(value, "body");
  exactKeys(
    body,
    ["identityToken", "authorizationCode", "rawNonce", "device"],
    "body",
  );
  return {
    identityToken: string(body.identityToken, "identityToken", 32, 16_384),
    authorizationCode: string(
      body.authorizationCode,
      "authorizationCode",
      8,
      4_096,
    ),
    rawNonce: string(body.rawNonce, "rawNonce", 16, 256),
    device: parseDevice(body.device),
  };
}

export function parseGoogleAuthRequest(value: unknown): GoogleAuthRequest {
  const body = record(value, "body");
  exactKeys(body, ["idToken", "device"], "body");
  return {
    idToken: string(body.idToken, "idToken", 32, 16_384),
    device: parseDevice(body.device),
  };
}

export function parseAppleIdentityLinkRequest(value: unknown): AppleCredential {
  const body = record(value, "body");
  exactKeys(body, ["identityToken", "authorizationCode", "rawNonce"], "body");
  return {
    identityToken: string(body.identityToken, "identityToken", 32, 16_384),
    authorizationCode: string(
      body.authorizationCode,
      "authorizationCode",
      8,
      4_096,
    ),
    rawNonce: string(body.rawNonce, "rawNonce", 16, 256),
  };
}

export function parseGoogleIdentityLinkRequest(
  value: unknown,
): GoogleCredential {
  const body = record(value, "body");
  exactKeys(body, ["idToken"], "body");
  return {
    idToken: string(body.idToken, "idToken", 32, 16_384),
  };
}

export function parseRefreshRequest(value: unknown): string {
  const body = record(value, "body");
  exactKeys(body, ["refreshToken"], "body");
  return string(body.refreshToken, "refreshToken", 32, 4_096);
}

export function parseLogoutRequest(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const body = record(value, "body");
  exactKeys(body, ["refreshToken"], "body");
  if (body.refreshToken === undefined) {
    return undefined;
  }
  return string(body.refreshToken, "refreshToken", 32, 4_096);
}

export function parseProvider(value: string): "APPLE" | "GOOGLE" {
  if (value !== "APPLE" && value !== "GOOGLE") {
    invalid("provider", "must be APPLE or GOOGLE");
  }
  return value;
}
