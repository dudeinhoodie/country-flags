export const NODE_ENVIRONMENTS = ["development", "test", "production"] as const;
export const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface EnvironmentVariables extends Record<string, unknown> {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  LOG_LEVEL: LogLevel;
  DATABASE_URL: string;
  TEST_AUTH_ENABLED: boolean;
  AUTH_PROVIDER_TEST_TOKENS_ENABLED: boolean;
  AUTH_PROVIDER_TEST_SECRET: string;
  AUTH_ACCESS_TOKEN_SECRET: string;
  AUTH_ACCESS_TOKEN_ISSUER: string;
  AUTH_ACCESS_TOKEN_AUDIENCE: string;
  AUTH_ACCESS_TOKEN_TTL_SECONDS: number;
  AUTH_REFRESH_TOKEN_TTL_SECONDS: number;
  AUTH_REAUTH_TOKEN_TTL_SECONDS: number;
  AUTH_RATE_LIMIT_SECRET: string;
  ACCOUNT_DATA_HASH_SECRET: string;
  DATA_EXPORT_DOWNLOAD_TTL_SECONDS: number;
  PUBLIC_BASE_URL: string;
  APPLE_CLIENT_IDS: string[];
  GOOGLE_CLIENT_IDS: string[];
  CORS_ALLOWED_ORIGINS: string[];
  SHUTDOWN_DRAIN_MS: number;
}

const TEST_PROVIDER_SECRET =
  "TEST_ONLY_country_flags_provider_signing_key_v1_never_for_production";
const TEST_ACCESS_SECRET =
  "TEST_ONLY_country_flags_access_signing_key_v1_never_for_production";
const TEST_RATE_LIMIT_SECRET =
  "TEST_ONLY_country_flags_rate_limit_key_v1_never_for_production";
const TEST_ACCOUNT_DATA_HASH_SECRET =
  "TEST_ONLY_country_flags_account_data_hash_key_v1_never_for_production";

function isOneOf<const T extends readonly string[]>(
  value: string,
  allowedValues: T,
): value is T[number] {
  return allowedValues.includes(value);
}

function requiredString(config: Record<string, unknown>, key: string): string {
  const value = config[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Environment variable ${key} is required`);
  }

  return value.trim();
}

function optionalString(value: unknown, fallback: string, key: string): string {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "string") {
    throw new Error(`Environment variable ${key} must be a string`);
  }

  return value;
}

function parsePort(value: unknown): number {
  const port = typeof value === "string" ? Number(value) : value;

  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error(
      "Environment variable PORT must be an integer from 1 to 65535",
    );
  }

  return port;
}

function validateDatabaseUrl(value: string): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error("Environment variable DATABASE_URL must be a valid URL");
  }

  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
    throw new Error("Environment variable DATABASE_URL must use PostgreSQL");
  }

  return value;
}

function validateHttpUrl(value: string, key: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error(`Environment variable ${key} must be a valid URL`);
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error(`Environment variable ${key} must use HTTP or HTTPS`);
  }
  return value.replace(/\/+$/, "");
}

function parseBoolean(value: unknown, fallback: boolean, key: string): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (value === "true" || value === true) {
    return true;
  }
  if (value === "false" || value === false) {
    return false;
  }

  throw new Error(`Environment variable ${key} must be true or false`);
}

function parseInteger(
  value: unknown,
  fallback: number,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `Environment variable ${key} must be an integer from ${minimum} to ${maximum}`,
    );
  }

  return parsed;
}

function commaSeparated(
  value: unknown,
  fallback: string[],
  key: string,
): string[] {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new Error(
      `Environment variable ${key} must be a comma-separated string`,
    );
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new Error(
      `Environment variable ${key} must contain at least one value`,
    );
  }

  return [...new Set(entries)];
}

function authSecret(
  config: Record<string, unknown>,
  key: string,
  fallback: string,
  nodeEnvironment: NodeEnvironment,
): string {
  if (nodeEnvironment === "production") {
    const value = requiredString(config, key);
    if (value.length < 32) {
      throw new Error(
        `Environment variable ${key} must contain at least 32 characters`,
      );
    }
    return value;
  }

  const value = optionalString(config[key], fallback, key);
  if (value.length < 32) {
    throw new Error(
      `Environment variable ${key} must contain at least 32 characters`,
    );
  }
  return value;
}

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const nodeEnvironment = optionalString(
    config.NODE_ENV,
    "development",
    "NODE_ENV",
  );
  const logLevel = optionalString(config.LOG_LEVEL, "info", "LOG_LEVEL");

  if (!isOneOf(nodeEnvironment, NODE_ENVIRONMENTS)) {
    throw new Error(
      `Environment variable NODE_ENV must be one of: ${NODE_ENVIRONMENTS.join(", ")}`,
    );
  }

  if (!isOneOf(logLevel, LOG_LEVELS)) {
    throw new Error(
      `Environment variable LOG_LEVEL must be one of: ${LOG_LEVELS.join(", ")}`,
    );
  }

  const testAuthEnabled = parseBoolean(
    config.TEST_AUTH_ENABLED,
    nodeEnvironment !== "production",
    "TEST_AUTH_ENABLED",
  );
  if (nodeEnvironment === "production" && testAuthEnabled) {
    throw new Error("TEST_AUTH_ENABLED cannot be enabled in production");
  }
  const providerTestTokensEnabled = parseBoolean(
    config.AUTH_PROVIDER_TEST_TOKENS_ENABLED,
    nodeEnvironment !== "production",
    "AUTH_PROVIDER_TEST_TOKENS_ENABLED",
  );
  if (nodeEnvironment === "production" && providerTestTokensEnabled) {
    throw new Error(
      "AUTH_PROVIDER_TEST_TOKENS_ENABLED cannot be enabled in production",
    );
  }

  const appleClientIds = commaSeparated(
    config.APPLE_CLIENT_IDS,
    nodeEnvironment === "production" ? [] : ["com.countryflags.local"],
    "APPLE_CLIENT_IDS",
  );
  const googleClientIds = commaSeparated(
    config.GOOGLE_CLIENT_IDS,
    nodeEnvironment === "production"
      ? []
      : ["country-flags-local.apps.googleusercontent.com"],
    "GOOGLE_CLIENT_IDS",
  );
  if (nodeEnvironment === "production" && appleClientIds.length === 0) {
    throw new Error("Environment variable APPLE_CLIENT_IDS is required");
  }
  if (nodeEnvironment === "production" && googleClientIds.length === 0) {
    throw new Error("Environment variable GOOGLE_CLIENT_IDS is required");
  }

  const corsAllowedOrigins = commaSeparated(
    config.CORS_ALLOWED_ORIGINS,
    nodeEnvironment === "production" ? [] : ["http://localhost:5173"],
    "CORS_ALLOWED_ORIGINS",
  );
  if (corsAllowedOrigins.includes("*")) {
    throw new Error(
      "Environment variable CORS_ALLOWED_ORIGINS must not contain a wildcard",
    );
  }

  return {
    ...config,
    NODE_ENV: nodeEnvironment,
    PORT: parsePort(config.PORT ?? 3000),
    LOG_LEVEL: logLevel,
    DATABASE_URL: validateDatabaseUrl(requiredString(config, "DATABASE_URL")),
    TEST_AUTH_ENABLED: testAuthEnabled,
    AUTH_PROVIDER_TEST_TOKENS_ENABLED: providerTestTokensEnabled,
    AUTH_PROVIDER_TEST_SECRET:
      nodeEnvironment === "production"
        ? ""
        : authSecret(
            config,
            "AUTH_PROVIDER_TEST_SECRET",
            TEST_PROVIDER_SECRET,
            nodeEnvironment,
          ),
    AUTH_ACCESS_TOKEN_SECRET: authSecret(
      config,
      "AUTH_ACCESS_TOKEN_SECRET",
      TEST_ACCESS_SECRET,
      nodeEnvironment,
    ),
    AUTH_ACCESS_TOKEN_ISSUER:
      nodeEnvironment === "production"
        ? requiredString(config, "AUTH_ACCESS_TOKEN_ISSUER")
        : optionalString(
            config.AUTH_ACCESS_TOKEN_ISSUER,
            "country-flags-local",
            "AUTH_ACCESS_TOKEN_ISSUER",
          ),
    AUTH_ACCESS_TOKEN_AUDIENCE:
      nodeEnvironment === "production"
        ? requiredString(config, "AUTH_ACCESS_TOKEN_AUDIENCE")
        : optionalString(
            config.AUTH_ACCESS_TOKEN_AUDIENCE,
            "country-flags-api",
            "AUTH_ACCESS_TOKEN_AUDIENCE",
          ),
    AUTH_ACCESS_TOKEN_TTL_SECONDS: parseInteger(
      config.AUTH_ACCESS_TOKEN_TTL_SECONDS,
      900,
      "AUTH_ACCESS_TOKEN_TTL_SECONDS",
      300,
      1_800,
    ),
    AUTH_REFRESH_TOKEN_TTL_SECONDS: parseInteger(
      config.AUTH_REFRESH_TOKEN_TTL_SECONDS,
      30 * 24 * 60 * 60,
      "AUTH_REFRESH_TOKEN_TTL_SECONDS",
      24 * 60 * 60,
      90 * 24 * 60 * 60,
    ),
    AUTH_REAUTH_TOKEN_TTL_SECONDS: parseInteger(
      config.AUTH_REAUTH_TOKEN_TTL_SECONDS,
      300,
      "AUTH_REAUTH_TOKEN_TTL_SECONDS",
      60,
      600,
    ),
    AUTH_RATE_LIMIT_SECRET: authSecret(
      config,
      "AUTH_RATE_LIMIT_SECRET",
      TEST_RATE_LIMIT_SECRET,
      nodeEnvironment,
    ),
    ACCOUNT_DATA_HASH_SECRET: authSecret(
      config,
      "ACCOUNT_DATA_HASH_SECRET",
      TEST_ACCOUNT_DATA_HASH_SECRET,
      nodeEnvironment,
    ),
    DATA_EXPORT_DOWNLOAD_TTL_SECONDS: parseInteger(
      config.DATA_EXPORT_DOWNLOAD_TTL_SECONDS,
      300,
      "DATA_EXPORT_DOWNLOAD_TTL_SECONDS",
      60,
      3_600,
    ),
    PUBLIC_BASE_URL: validateHttpUrl(
      nodeEnvironment === "production"
        ? requiredString(config, "PUBLIC_BASE_URL")
        : optionalString(
            config.PUBLIC_BASE_URL,
            "http://localhost:3000",
            "PUBLIC_BASE_URL",
          ),
      "PUBLIC_BASE_URL",
    ),
    APPLE_CLIENT_IDS: appleClientIds,
    GOOGLE_CLIENT_IDS: googleClientIds,
    CORS_ALLOWED_ORIGINS: corsAllowedOrigins,
    SHUTDOWN_DRAIN_MS: parseInteger(
      config.SHUTDOWN_DRAIN_MS,
      5_000,
      "SHUTDOWN_DRAIN_MS",
      0,
      30_000,
    ),
  };
}
