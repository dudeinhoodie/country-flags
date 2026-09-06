import { Injectable } from "@nestjs/common";

import { JsonLoggerService } from "../logging/json-logger.service";
import { MetricsService } from "./metrics.service";

/**
 * What a polling worker knows about its own queue. Every worker in the API
 * already computes exactly these four numbers to answer "is anything stuck"; the
 * point of the shared shape is that one alert can be written once and asked of
 * all of them.
 */
export interface WorkerBacklogSnapshot {
  pending: number;
  processing: number;
  deadLetter: number;
  oldestPendingAgeMs: number | null;
}

/**
 * Reported at most this often per queue. The workers poll once or twice a
 * second, which is the right rate for draining and the wrong rate for a log
 * line: a minute is fine for a signal whose alert thresholds are measured in
 * tens of minutes, and it keeps the log volume of an idle deployment flat.
 */
const REPORT_INTERVAL_MS = 60_000;

/**
 * Publishes worker backlog in both directions at once, and that duplication is
 * deliberate.
 *
 * The gauges are the real signal and go wherever OTLP points. But no collector
 * is deployed (`OTEL_ENABLED` is unset on the hosted revisions), so a metric
 * alone would be an alert nobody can build. The log line carries the same three
 * numbers into the platform's own log store, where a log-based metric and an
 * alert policy can be written against it with no collector at all — see
 * `infrastructure/monitoring/`.
 *
 * Nothing here may throw into a worker's poll loop: a telemetry failure must
 * cost the signal, never the drain.
 */
@Injectable()
export class WorkerBacklogService {
  private readonly lastReportedAt = new Map<string, number>();

  constructor(
    private readonly metrics: MetricsService,
    private readonly logger: JsonLoggerService,
  ) {}

  report(queue: string, snapshot: WorkerBacklogSnapshot): void {
    const now = Date.now();
    const previous = this.lastReportedAt.get(queue);
    if (previous !== undefined && now - previous < REPORT_INTERVAL_MS) {
      return;
    }
    this.lastReportedAt.set(queue, now);

    const oldestPendingAgeSeconds = (snapshot.oldestPendingAgeMs ?? 0) / 1_000;
    try {
      this.metrics.recordOutboxDepth(
        queue,
        snapshot.pending,
        oldestPendingAgeSeconds,
        snapshot.deadLetter,
      );
      // A heartbeat, not an error: it is emitted whether or not the queue is
      // healthy, because an alert on a backlog that stopped moving needs the
      // healthy readings too — without them it cannot tell "nothing pending"
      // from "the worker stopped reporting".
      this.logger.log({
        message: "Worker backlog snapshot",
        event: "worker_backlog_snapshot",
        queue,
        pending: snapshot.pending,
        processing: snapshot.processing,
        deadLetter: snapshot.deadLetter,
        oldestPendingAgeSeconds,
      });
    } catch {
      // Deliberately swallowed. See the class comment.
    }
  }
}
