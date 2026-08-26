import {
  DEPLOYMENT_ENVIRONMENTS,
  type DeploymentEnvironment,
  defaultDeploymentEnvironment,
  isDeploymentEnvironment,
  isHostedDeploymentEnvironment,
} from "./deployment-environment";

export const NODE_ENVIRONMENTS = ["development", "test", "production"] as const;
export const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface EnvironmentVariables extends Record<string, unknown> {
  NODE_ENV: NodeEnvironment;
  DEPLOYMENT_ENV: DeploymentEnvironment;
  PORT: number;
  LOG_LEVEL: LogLevel;
  DATABASE_URL: string;
  DIRECT_DATABASE_URL: string;
  SERVICE_NAME: string;
  SERVICE_RELEASE: string;
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
  ADMIN_GOOGLE_CLIENT_IDS: string[];
  ADMIN_EMAIL_ALLOWLIST: string[];
  ADMIN_ALLOWED_ORIGINS: string[];
  ADMIN_SESSION_IDLE_TTL_SECONDS: number;
  ADMIN_SESSION_ABSOLUTE_TTL_SECONDS: number;
  ADMIN_CATALOG_PATH: string;
  ADMIN_EDITORIAL_SCHEMA_PATH: string;
  ADMIN_ASSET_MAX_BYTES: number;
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

function validateDatabaseUrl(value: string, key: string): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error(`Environment variable ${key} must be a valid URL`);
  }

  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
    throw new Error(`Environment variable ${key} must use PostgreSQL`);
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

function resolveDeploymentEnvironment(
  config: Record<string, unknown>,
  nodeEnvironment: NodeEnvironment,
): DeploymentEnvironment {
  const raw = config.DEPLOYMENT_ENV;

  if (raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    const fallback = defaultDeploymentEnvironment(nodeEnvironment);
    if (fallback === undefined) {
      throw new Error(
        "Environment variable DEPLOYMENT_ENV is required when NODE_ENV is production",
      );
    }
    return fallback;
  }

  if (typeof raw !== "string") {
    throw new Error("Environment variable DEPLOYMENT_ENV must be a string");
  }

  const value = raw.trim();
  if (!isDeploymentEnvironment(value)) {
    throw new Error(
      `Environment variable DEPLOYMENT_ENV must be one of: ${DEPLOYMENT_ENVIRONMENTS.join(", ")}`,
    );
  }

  return value;
}

/**
 * A hosted release must be traceable back to the image it was built from, so the
 * placeholder that local and CI runs rely on is rejected there.
 */
function releaseIdentifier(
  config: Record<string, unknown>,
  hosted: boolean,
): string {
  if (!hosted) {
    return optionalString(config.SERVICE_RELEASE, "dev", "SERVICE_RELEASE");
  }

  const value = requiredString(config, "SERVICE_RELEASE");
  if (value === "dev") {
    throw new Error(
      "Environment variable SERVICE_RELEASE must identify the deployed release, not the local placeholder",
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

  const deploymentEnvironment = resolveDeploymentEnvironment(
    config,
    nodeEnvironment,
  );
  const hosted = isHostedDeploymentEnvironment(deploymentEnvironment);
  if (hosted && nodeEnvironment !== "production") {
    throw new Error(
      `Deployment environment ${deploymentEnvironment} requires NODE_ENV=production, received ${nodeEnvironment}`,
    );
  }

  // Hosted environments are covered by `hosted`; the NODE_ENV check additionally
  // holds a production build run locally (Compose, CI image smoke) to the same
  // rule, so a release artifact never gains test auth by changing DEPLOYMENT_ENV.
  const testShortcutsAllowed = !hosted && nodeEnvironment !== "production";
  const rejectTestShortcut = (key: string): never => {
    throw new Error(
      `${key} cannot be enabled with NODE_ENV=${nodeEnvironment} and DEPLOYMENT_ENV=${deploymentEnvironment}`,
    );
  };

  const testAuthEnabled = parseBoolean(
    config.TEST_AUTH_ENABLED,
    testShortcutsAllowed,
    "TEST_AUTH_ENABLED",
  );
  if (!testShortcutsAllowed && testAuthEnabled) {
    rejectTestShortcut("TEST_AUTH_ENABLED");
  }
  const providerTestTokensEnabled = parseBoolean(
    config.AUTH_PROVIDER_TEST_TOKENS_ENABLED,
    testShortcutsAllowed,
    "AUTH_PROVIDER_TEST_TOKENS_ENABLED",
  );
  if (!testShortcutsAllowed && providerTestTokensEnabled) {
    rejectTestShortcut("AUTH_PROVIDER_TEST_TOKENS_ENABLED");
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

  // The admin console is a separate Google OAuth client; falling back to the
  // consumer client ids keeps local and test setups to one configuration.
  const adminGoogleClientIds = commaSeparated(
    config.ADMIN_GOOGLE_CLIENT_IDS,
    googleClientIds,
    "ADMIN_GOOGLE_CLIENT_IDS",
  );
  // Empty by default: nobody can bootstrap admin access until the deployment
  // provides the allowlist (from Secret Manager in hosted environments).
  const adminEmailAllowlist = commaSeparated(
    config.ADMIN_EMAIL_ALLOWLIST,
    [],
    "ADMIN_EMAIL_ALLOWLIST",
  );
  const adminAllowedOrigins = commaSeparated(
    config.ADMIN_ALLOWED_ORIGINS,
    nodeEnvironment === "production" ? [] : ["http://localhost:5173"],
    "ADMIN_ALLOWED_ORIGINS",
  );
  if (corsAllowedOrigins.includes("*")) {
    throw new Error(
      "Environment variable CORS_ALLOWED_ORIGINS must not contain a wildcard",
    );
  }

  // The GitHub credential is read by the admin drafts module straight from
  // process.env and is optional: an unconfigured deployment degrades to the
  // manual export path. A partial configuration must not exist, though — an
  // operator who set one of the three believes the console can propose, and
  // nothing would say otherwise until the button fails.
  const githubVariables = [
    "ADMIN_GITHUB_TOKEN",
    "ADMIN_GITHUB_OWNER",
    "ADMIN_GITHUB_REPOSITORY",
  ] as const;
  const missingGithubVariables = githubVariables.filter((name) => {
    const value = config[name];
    return typeof value !== "string" || value.trim().length === 0;
  });
  if (
    missingGithubVariables.length > 0 &&
    missingGithubVariables.length < githubVariables.length
  ) {
    throw new Error(
      `Environment variables ${githubVariables.join(", ")} must be set together; missing: ${missingGithubVariables.join(", ")}`,
    );
  }

  const databaseUrl = validateDatabaseUrl(
    requiredString(config, "DATABASE_URL"),
    "DATABASE_URL",
  );
  // Hosted runtimes talk to a pooler that cannot run migrations, so the direct
  // connection is a separate required variable there. Local and CI reach the same
  // database either way and fall back to the runtime URL.
  const rawDirectDatabaseUrl = config.DIRECT_DATABASE_URL;
  const hasDirectDatabaseUrl =
    typeof rawDirectDatabaseUrl === "string" &&
    rawDirectDatabaseUrl.trim().length > 0;
  if (hosted && !hasDirectDatabaseUrl) {
    throw new Error("Environment variable DIRECT_DATABASE_URL is required");
  }

  return {
    ...config,
    NODE_ENV: nodeEnvironment,
    DEPLOYMENT_ENV: deploymentEnvironment,
    PORT: parsePort(config.PORT ?? 3000),
    LOG_LEVEL: logLevel,
    DATABASE_URL: databaseUrl,
    DIRECT_DATABASE_URL: hasDirectDatabaseUrl
      ? validateDatabaseUrl(rawDirectDatabaseUrl.trim(), "DIRECT_DATABASE_URL")
      : databaseUrl,
    SERVICE_NAME: optionalString(
      config.SERVICE_NAME,
      "country-flags-api",
      "SERVICE_NAME",
    ),
    SERVICE_RELEASE: releaseIdentifier(config, hosted),
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
    ADMIN_GOOGLE_CLIENT_IDS: adminGoogleClientIds,
    ADMIN_EMAIL_ALLOWLIST: adminEmailAllowlist,
    ADMIN_ALLOWED_ORIGINS: adminAllowedOrigins,
    ADMIN_SESSION_IDLE_TTL_SECONDS: parseInteger(
      config.ADMIN_SESSION_IDLE_TTL_SECONDS,
      3_600,
      "ADMIN_SESSION_IDLE_TTL_SECONDS",
      300,
      86_400,
    ),
    ADMIN_SESSION_ABSOLUTE_TTL_SECONDS: parseInteger(
      config.ADMIN_SESSION_ABSOLUTE_TTL_SECONDS,
      43_200,
      "ADMIN_SESSION_ABSOLUTE_TTL_SECONDS",
      3_600,
      604_800,
    ),
    // Resolved against the working directory: the monorepo layout by
    // default, the baked-in image paths in a container (backend/Dockerfile).
    ADMIN_CATALOG_PATH: optionalString(
      config.ADMIN_CATALOG_PATH,
      "../tools/content-pipeline/editorial/catalog.json",
      "ADMIN_CATALOG_PATH",
    ),
    ADMIN_EDITORIAL_SCHEMA_PATH: optionalString(
      config.ADMIN_EDITORIAL_SCHEMA_PATH,
      "../contracts/schemas/content/editorial-catalog.v1.schema.json",
      "ADMIN_EDITORIAL_SCHEMA_PATH",
    ),
    // Flags and coats of arms are small; the limit exists to stop a
    // pathological upload rather than to size a real one.
    ADMIN_ASSET_MAX_BYTES: parseInteger(
      config.ADMIN_ASSET_MAX_BYTES,
      2 * 1024 * 1024,
      "ADMIN_ASSET_MAX_BYTES",
      1024,
      50 * 1024 * 1024,
    ),
    SHUTDOWN_DRAIN_MS: parseInteger(
      config.SHUTDOWN_DRAIN_MS,
      5_000,
      "SHUTDOWN_DRAIN_MS",
      0,
      30_000,
    ),
  };
}
