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
const storeTransactionVerificationsTotal = meter.createCounter(
  "store_transaction_verifications_total",
  { description: "Signed store transactions accepted or refused, by outcome" },
);
const storeNotificationsTotal = meter.createCounter(
  "store_notifications_total",
  { description: "Store server notifications handled, by outcome" },
);
const storeReconciliationRunsTotal = meter.createCounter(
  "store_reconciliation_runs_total",
  { description: "Store reconciliation sweeps, by outcome" },
);
const storeReconciliationDurationSeconds = meter.createHistogram(
  "store_reconciliation_duration_seconds",
  { description: "How long a store reconciliation sweep took", unit: "s" },
);
const clientVersionGateTotal = meter.createCounter(
  "client_version_gate_total",
  {
    description:
      "Catalog requests classified by whether the client build understands paid decks",
  },
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

  /**
   * One counter for every signed transaction this deployment looked at,
   * labelled with the stable verification code. That label is what the
   * paid-decks alerts are written against — an invalid-signature spike, an
   * unknown product, a Sandbox purchase reaching production — and it is
   * bounded by the code list, so the cardinality rule holds.
   */
  recordStoreTransactionVerification(outcome: string): void {
    storeTransactionVerificationsTotal.add(1, { outcome });
  }

  /**
   * Every notification this deployment was sent, by what became of it. A
   * quarantine that stays above zero means the catalog and App Store Connect
   * disagree; a duplicate rate near one means Apple is retrying because
   * something answers slowly (§17.1).
   */
  recordStoreNotification(
    outcome: "processed" | "duplicate" | "quarantined" | "refused",
  ): void {
    storeNotificationsTotal.add(1, { outcome });
  }

  /**
   * One counter and one duration per sweep. The alert §17.1 asks for is
   * written on the absence of a success rather than on a failure: a job that
   * stops being scheduled fails nothing at all, and that is the outage worth
   * catching.
   */
  recordStoreReconciliation(
    outcome: "succeeded" | "failed",
    durationSeconds: number,
  ): void {
    storeReconciliationRunsTotal.add(1, { outcome });
    storeReconciliationDurationSeconds.record(durationSeconds, { outcome });
  }

  /**
   * Every catalog request the client-version gate looked at, by what it
   * decided. Both labels are closed sets — the route template and the outcome
   * enum — so the raw version a client sent never becomes a series.
   *
   * This is the counter that answers "nobody upgraded" before support does:
   * the share of `below_minimum` and `version_missing` on `GET /v1/decks` is
   * the fraction of traffic that would be handed a locked deck it cannot
   * render, and it has to fall before paid content is published to everybody
   * (docs/17-paid-decks-storekit.md §20).
   */
  recordClientVersionGate(route: string, outcome: string): void {
    clientVersionGateTotal.add(1, { route, outcome });
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
