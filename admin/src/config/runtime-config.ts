export const ADMIN_ENVIRONMENTS = ["local", "dev", "prod"] as const;

export type AdminEnvironment = (typeof ADMIN_ENVIRONMENTS)[number];

/**
 * The parts of the console a deployment can switch on.
 *
 * A flag is how a screen the redesign wants gone stays reachable while the
 * work that replaces it is checked against it (§14). It is not a
 * configuration surface for taste: each one names a specific escape hatch and
 * is expected to be removed with the hatch.
 *
 * - `advancedOverrides` — the raw dotted-path override table. §6.2 takes it
 *   out of the ordinary editor: an editorial override typed as a path is a
 *   way to write a field no form validates. It stays behind this flag, and
 *   behind the ADMIN role, for the emergencies the typed fields cannot reach.
 */
export const ADMIN_FEATURES = ["advancedOverrides"] as const;

export type AdminFeature = (typeof ADMIN_FEATURES)[number];

export type AdminFeatures = Readonly<Partial<Record<AdminFeature, boolean>>>;

export interface RuntimeConfig {
  readonly environment: AdminEnvironment;
  readonly apiBasePath: string;
  readonly googleClientId: string;
  readonly appVersion: string;
  /** Absent in a config written before flags existed, which means none. */
  readonly features: AdminFeatures;
}

export const RUNTIME_CONFIG_URL = "/config.json";

/**
 * Raised when the runtime config cannot be fetched or fails validation.
 * The app must not start with a broken config: rendering against a wrong
 * environment is exactly the mistake the config exists to prevent.
 */
export class RuntimeConfigError extends Error {
  readonly problems: readonly string[];

  constructor(message: string, problems: readonly string[] = []) {
    super(message);
    this.name = "RuntimeConfigError";
    this.problems = problems;
  }
}

function isAdminEnvironment(value: string): value is AdminEnvironment {
  return (ADMIN_ENVIRONMENTS as readonly string[]).includes(value);
}

function readEnvironment(
  record: Record<string, unknown>,
  problems: string[],
): AdminEnvironment | undefined {
  const value = record.environment;
  if (typeof value !== "string" || !isAdminEnvironment(value)) {
    problems.push(
      `"environment" must be one of: ${ADMIN_ENVIRONMENTS.join(", ")}`,
    );
    return undefined;
  }
  return value;
}

function readApiBasePath(
  record: Record<string, unknown>,
  problems: string[],
): string | undefined {
  const value = record.apiBasePath;
  if (typeof value !== "string" || !value.startsWith("/")) {
    problems.push('"apiBasePath" must be an absolute path starting with "/"');
    return undefined;
  }
  return value;
}

function readGoogleClientId(
  record: Record<string, unknown>,
  problems: string[],
): string | undefined {
  const value = record.googleClientId;
  // Empty is tolerated until the admin sign-in flow lands; a wrong type is not.
  if (typeof value !== "string") {
    problems.push('"googleClientId" must be a string');
    return undefined;
  }
  return value;
}

function readAppVersion(
  record: Record<string, unknown>,
  problems: string[],
): string | undefined {
  const value = record.appVersion;
  if (typeof value !== "string" || value.length === 0) {
    problems.push('"appVersion" must be a non-empty string');
    return undefined;
  }
  return value;
}

/**
 * Which flags this deployment turns on.
 *
 * Missing is the same as none: a console served a config from before a flag
 * existed must start with the flag off rather than refuse to start. A flag
 * this build does not know is ignored, so a rollback does not have to be
 * co-ordinated with the config that mentions it.
 */
function readFeatures(
  record: Record<string, unknown>,
  problems: string[],
): AdminFeatures | undefined {
  const value = record.features;
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    problems.push('"features" must be an object of booleans');
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const features: Partial<Record<AdminFeature, boolean>> = {};
  for (const name of ADMIN_FEATURES) {
    const flag = source[name];
    if (flag === undefined) {
      continue;
    }
    if (typeof flag !== "boolean") {
      problems.push(`"features.${name}" must be a boolean`);
      return undefined;
    }
    features[name] = flag;
  }
  return features;
}

export function parseRuntimeConfig(input: unknown): RuntimeConfig {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new RuntimeConfigError("Runtime config must be a JSON object");
  }
  const record = input as Record<string, unknown>;
  const problems: string[] = [];
  const environment = readEnvironment(record, problems);
  const apiBasePath = readApiBasePath(record, problems);
  const googleClientId = readGoogleClientId(record, problems);
  const appVersion = readAppVersion(record, problems);
  const features = readFeatures(record, problems);
  if (
    environment === undefined ||
    apiBasePath === undefined ||
    googleClientId === undefined ||
    appVersion === undefined ||
    features === undefined
  ) {
    throw new RuntimeConfigError("Runtime config is invalid", problems);
  }
  return { environment, apiBasePath, googleClientId, appVersion, features };
}

function describeUnknownError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  let response: Response;
  try {
    response = await fetch(RUNTIME_CONFIG_URL, { cache: "no-store" });
  } catch (cause) {
    throw new RuntimeConfigError(`Failed to fetch ${RUNTIME_CONFIG_URL}`, [
      describeUnknownError(cause),
    ]);
  }
  if (!response.ok) {
    throw new RuntimeConfigError(
      `Fetching ${RUNTIME_CONFIG_URL} returned HTTP ${String(response.status)}`,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new RuntimeConfigError(`${RUNTIME_CONFIG_URL} is not valid JSON`, [
      describeUnknownError(cause),
    ]);
  }
  return parseRuntimeConfig(payload);
}
