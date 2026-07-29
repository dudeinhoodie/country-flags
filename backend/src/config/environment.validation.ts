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
}

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

  return {
    ...config,
    NODE_ENV: nodeEnvironment,
    PORT: parsePort(config.PORT ?? 3000),
    LOG_LEVEL: logLevel,
    DATABASE_URL: validateDatabaseUrl(requiredString(config, "DATABASE_URL")),
    TEST_AUTH_ENABLED: testAuthEnabled,
  };
}
