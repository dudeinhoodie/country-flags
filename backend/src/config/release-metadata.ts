import {
  type DeploymentEnvironment,
  readDeploymentEnvironment,
} from "./deployment-environment";

/**
 * What every log line, span and metric carries so that one release SHA leads to
 * the deployment that produced it. `release` alone is not enough: dev and prod
 * run the same image, and one release can be rolled out more than once, so the
 * environment and the provider's own deployment identifier travel beside it.
 */
export interface ReleaseMetadata {
  service: string;
  environment: DeploymentEnvironment;
  release: string;
  /**
   * The provider's identifier for this rollout — a Cloud Run revision name. Set
   * by the platform rather than by the deploy: Cloud Run injects `K_REVISION`
   * into every container it starts, and the revision name is the only handle
   * that separates two rollouts of one SHA.
   */
  deploymentId?: string;
  /**
   * The last Prisma migration the release was deployed against. A revision that
   * reports an older migration than the database is the shape of a half-applied
   * expand/contract, and no other signal shows it.
   */
  migrationVersion?: string;
}

const DEFAULT_SERVICE_NAME = "country-flags-api";
const LOCAL_RELEASE_PLACEHOLDER = "dev";

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Read from raw `process.env` rather than from `ConfigService`: the logger and
 * the OpenTelemetry resource are both built before Nest validates configuration,
 * and both must agree on the same five values.
 */
export function readReleaseMetadata(
  env: NodeJS.ProcessEnv = process.env,
): ReleaseMetadata {
  const deploymentId = optional(env.DEPLOYMENT_ID) ?? optional(env.K_REVISION);
  const migrationVersion = optional(env.MIGRATION_VERSION);
  return {
    service: optional(env.SERVICE_NAME) ?? DEFAULT_SERVICE_NAME,
    environment: readDeploymentEnvironment(env),
    release: optional(env.SERVICE_RELEASE) ?? LOCAL_RELEASE_PLACEHOLDER,
    // Absent rather than undefined: the two consumers spread this into a log
    // entry and an OpenTelemetry resource, and neither should carry a key whose
    // value is nothing.
    ...(deploymentId !== undefined ? { deploymentId } : {}),
    ...(migrationVersion !== undefined ? { migrationVersion } : {}),
  };
}
