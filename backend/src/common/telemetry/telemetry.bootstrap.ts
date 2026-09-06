import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

import { readReleaseMetadata } from "../../config/release-metadata";

let activeSdk: NodeSDK | undefined;

/**
 * `deployment.id` is stable OpenTelemetry semantic convention only in the
 * incubating package; naming it here keeps the resource key right without
 * importing a module whose exports move between minor versions.
 */
const ATTR_DEPLOYMENT_ID = "deployment.id";
/**
 * No semantic convention covers "which schema version this release ran against",
 * so the key is ours. It is prefixed to say so rather than squatting on a name
 * OpenTelemetry may later define differently.
 */
const ATTR_MIGRATION_VERSION = "country_flags.migration.version";

/**
 * Identifies which deployment produced a span or metric. `deployment.environment.name`
 * carries what `service.version` alone cannot: dev and prod run the same production
 * build, so only this attribute separates their telemetry. `deployment.id` separates
 * two rollouts of one release, which `service.version` also cannot.
 */
export function telemetryResourceAttributes(
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const metadata = readReleaseMetadata(env);
  return {
    [ATTR_SERVICE_NAME]: metadata.service,
    [ATTR_SERVICE_VERSION]: metadata.release,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: metadata.environment,
    ...(metadata.deploymentId !== undefined
      ? { [ATTR_DEPLOYMENT_ID]: metadata.deploymentId }
      : {}),
    ...(metadata.migrationVersion !== undefined
      ? { [ATTR_MIGRATION_VERSION]: metadata.migrationVersion }
      : {}),
  };
}

/**
 * Starts OpenTelemetry export only when explicitly enabled. `@opentelemetry/api`'s
 * own tracer/meter are already no-ops when no SDK is registered, so leaving
 * OTEL_ENABLED unset (or the endpoint empty) *is* the "NoOp exporter by default"
 * behavior — there is no separate NoOp implementation to maintain here. Must run
 * before `NestFactory.create` so nothing under instrumentation is required first.
 */
export function bootstrapTelemetry(env: NodeJS.ProcessEnv = process.env): void {
  if (env.OTEL_ENABLED !== "true") {
    return;
  }
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (endpoint === undefined || endpoint.length === 0) {
    return;
  }
  const baseUrl = endpoint.replace(/\/+$/, "");

  // A misconfigured or unreachable collector must cost telemetry, never the API:
  // this runs before Nest boots, so an exception escaping here would turn an
  // observability outage into an outage. The failure is announced on stderr in
  // the same JSON shape the logger uses, because no logger exists yet.
  try {
    const sdk = new NodeSDK({
      resource: resourceFromAttributes(telemetryResourceAttributes(env)),
      traceExporter: new OTLPTraceExporter({ url: `${baseUrl}/v1/traces` }),
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: `${baseUrl}/v1/metrics` }),
        }),
      ],
    });
    sdk.start();
    activeSdk = sdk;
  } catch (error) {
    activeSdk = undefined;
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        ...telemetryResourceAttributes(env),
        message: "OpenTelemetry export could not start; continuing without it",
        event: "telemetry_bootstrap_failed",
        errorClass: error instanceof Error ? error.name : "UnknownError",
      })}\n`,
    );
  }
}

/** An unreachable OTLP collector must not turn a graceful shutdown into a failure. */
export async function shutdownTelemetry(): Promise<void> {
  try {
    await activeSdk?.shutdown();
  } catch {
    // Best-effort flush; the process is shutting down regardless.
  } finally {
    activeSdk = undefined;
  }
}
