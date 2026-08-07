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

import { readDeploymentEnvironment } from "../../config/deployment-environment";

let activeSdk: NodeSDK | undefined;

/**
 * Identifies which deployment produced a span or metric. `deployment.environment.name`
 * carries what `service.version` alone cannot: dev and prod run the same production
 * build, so only this attribute separates their telemetry.
 */
export function telemetryResourceAttributes(
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  return {
    [ATTR_SERVICE_NAME]: env.SERVICE_NAME ?? "country-flags-api",
    [ATTR_SERVICE_VERSION]: env.SERVICE_RELEASE ?? "dev",
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: readDeploymentEnvironment(env),
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

  activeSdk = new NodeSDK({
    resource: resourceFromAttributes(telemetryResourceAttributes(env)),
    traceExporter: new OTLPTraceExporter({ url: `${baseUrl}/v1/traces` }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${baseUrl}/v1/metrics` }),
      }),
    ],
  });
  activeSdk.start();
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
