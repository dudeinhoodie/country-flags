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
const outboxDeadLetterDepth = meter.createGauge("outbox_dead_letter_depth", {
  description: "Items a queue gave up on and will not retry",
});
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
   * The three numbers an alert needs from a queue. Depth alone cannot tell a
   * busy worker from a stopped one — a queue draining at a thousand a second
   * and a queue that stopped draining an hour ago both read as "deep" — so the
   * age of the oldest pending item is what the lag alert is written against.
   * Dead-letter depth is the third: retries exhausted stop aging the queue and
   * would otherwise disappear from both other numbers.
   */
  recordOutboxDepth(
    queue: string,
    depth: number,
    oldestPendingAgeSeconds: number,
    deadLetterDepth = 0,
  ): void {
    outboxDepth.record(depth, { queue });
    outboxOldestPendingAgeSeconds.record(oldestPendingAgeSeconds, { queue });
    outboxDeadLetterDepth.record(deadLetterDepth, { queue });
  }
}
