import type { ConsentCategory, Prisma } from "@prisma/client";

export const ANALYTICS_EXPORTER = Symbol("ANALYTICS_EXPORTER");

export interface AnalyticsEventEnvelope {
  eventId: string;
  eventName: string;
  schemaVersion: number;
  occurredAt: Date;
  analyticsSubjectId: string | null;
  anonymousId: string | null;
  consentCategory: ConsentCategory;
  properties: Prisma.JsonValue;
  context: Prisma.JsonValue;
}

/** Provider-neutral delivery boundary — a real analytics provider adapter replaces NoOp without touching the outbox worker. */
export interface AnalyticsExporter {
  publish(event: AnalyticsEventEnvelope): Promise<void>;
}

export class NoOpAnalyticsExporter implements AnalyticsExporter {
  publish(event: AnalyticsEventEnvelope): Promise<void> {
    void event;
    return Promise.resolve();
  }
}
