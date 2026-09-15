export const SITE_ENVIRONMENTS = ["local", "dev", "prod"] as const;

export type SiteEnvironment = (typeof SITE_ENVIRONMENTS)[number];

/**
 * What the container tells the page at startup (`/config.json`). The image
 * is environment-agnostic: one build is promoted dev → prod, and the only
 * thing that changes is this file, written by the container's entrypoint.
 */
export interface RuntimeConfig {
  readonly environment: SiteEnvironment;
  readonly appVersion: string;
}

export const RUNTIME_CONFIG_URL = "/config.json";

export class RuntimeConfigError extends Error {
  readonly problems: readonly string[];

  constructor(message: string, problems: readonly string[] = []) {
    super(message);
    this.name = "RuntimeConfigError";
    this.problems = problems;
  }
}

function isSiteEnvironment(value: string): value is SiteEnvironment {
  return (SITE_ENVIRONMENTS as readonly string[]).includes(value);
}

export function parseRuntimeConfig(value: unknown): RuntimeConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RuntimeConfigError("The runtime config is not an object");
  }
  const record = value as Record<string, unknown>;
  const problems: string[] = [];
  const environment = record.environment;
  if (typeof environment !== "string" || !isSiteEnvironment(environment)) {
    problems.push(
      `"environment" must be one of: ${SITE_ENVIRONMENTS.join(", ")}`,
    );
  }
  const appVersion = record.appVersion;
  if (typeof appVersion !== "string" || appVersion.length === 0) {
    problems.push('"appVersion" must be a non-empty string');
  }
  if (problems.length > 0) {
    throw new RuntimeConfigError("The runtime config is invalid", problems);
  }
  return {
    environment: environment as SiteEnvironment,
    appVersion: appVersion as string,
  };
}

/**
 * Fails closed: a page that cannot tell which deployment it is must not
 * pretend to be one. `no-store` because the file is the one thing that must
 * never be served stale across a promotion.
 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch(RUNTIME_CONFIG_URL, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new RuntimeConfigError(
      `${RUNTIME_CONFIG_URL} answered ${String(response.status)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new RuntimeConfigError(`${RUNTIME_CONFIG_URL} is not JSON`);
  }
  return parseRuntimeConfig(parsed);
}
