export const DEPLOYMENT_ENVIRONMENTS = ["local", "ci", "dev", "prod"] as const;

export type DeploymentEnvironment = (typeof DEPLOYMENT_ENVIRONMENTS)[number];

export function isDeploymentEnvironment(
  value: string,
): value is DeploymentEnvironment {
  return (DEPLOYMENT_ENVIRONMENTS as readonly string[]).includes(value);
}

/**
 * `dev` and `prod` are shared, internet-reachable deployments holding real user
 * data and real OAuth clients. `local` and `ci` are disposable, which is what
 * makes the test auth shortcuts acceptable there and nowhere else.
 */
export function isHostedDeploymentEnvironment(
  deploymentEnvironment: DeploymentEnvironment,
): boolean {
  return deploymentEnvironment === "dev" || deploymentEnvironment === "prod";
}

/**
 * NODE_ENV cannot tell `dev` from `prod` — both hosted environments run the
 * production build — so a production runtime gets no default and must name its
 * deployment environment explicitly instead of inheriting a guess.
 */
export function defaultDeploymentEnvironment(
  nodeEnvironment: string,
): DeploymentEnvironment | undefined {
  if (nodeEnvironment === "development") {
    return "local";
  }
  if (nodeEnvironment === "test") {
    return "ci";
  }
  return undefined;
}

/**
 * Logs and OpenTelemetry resources are built from raw `process.env` before Nest
 * validates configuration, so this read stays lenient. An unusable value is
 * labelled as the most sensitive environment rather than thrown from a module
 * body; `validateEnvironment` aborts startup moments later with the precise
 * message.
 */
export function readDeploymentEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): DeploymentEnvironment {
  const value = env.DEPLOYMENT_ENV?.trim();
  if (value !== undefined && isDeploymentEnvironment(value)) {
    return value;
  }

  return defaultDeploymentEnvironment(env.NODE_ENV ?? "development") ?? "prod";
}
