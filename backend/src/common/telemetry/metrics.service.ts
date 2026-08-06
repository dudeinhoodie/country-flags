import { Injectable } from "@nestjs/common";
import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("country-flags-api");

const httpRequestsTotal = meter.createCounter("http_requests_total", {
  description: "Total HTTP requests handled",
});
const httpRequestDurationMs = meter.createHistogram(
  "http_request_duration_ms",
  { description: "HTTP request duration", unit: "ms" },
);
const errorsTotal = meter.createCounter("errors_total", {
  description: "Unexpected errors reported via the exception filter",
});
const outboxDepth = meter.createGauge("outbox_depth", {
  description: "Pending items in a transactional outbox queue",
});
const outboxOldestPendingAgeSeconds = meter.createGauge(
  "outbox_oldest_pending_age_seconds",
  { description: "Age of the oldest pending outbox item", unit: "s" },
);

export type StatusClass = "2xx" | "3xx" | "4xx" | "5xx";

export function statusClassOf(statusCode: number): StatusClass {
  if (statusCode < 300) {
    return "2xx";
  }
  if (statusCode < 400) {
    return "3xx";
  }
  if (statusCode < 500) {
    return "4xx";
  }
  return "5xx";
}

/**
 * Thin wrapper over the OpenTelemetry Metrics API. Labels are restricted to
 * route templates, status classes, and error code enums — never user/request/
 * resource IDs or raw URLs, per the metric-label cardinality rule.
 */
@Injectable()
export class MetricsService {
  recordHttpRequest(
    routeTemplate: string,
    statusCode: number,
    durationMs: number,
  ): void {
    const attributes = {
      route: routeTemplate,
      statusClass: statusClassOf(statusCode),
    };
    httpRequestsTotal.add(1, attributes);
    httpRequestDurationMs.record(durationMs, attributes);
  }

  recordError(errorCode: string): void {
    errorsTotal.add(1, { errorCode });
  }

  recordOutboxDepth(
    queue: string,
    depth: number,
    oldestPendingAgeSeconds: number,
  ): void {
    outboxDepth.record(depth, { queue });
    outboxOldestPendingAgeSeconds.record(oldestPendingAgeSeconds, { queue });
  }
}
