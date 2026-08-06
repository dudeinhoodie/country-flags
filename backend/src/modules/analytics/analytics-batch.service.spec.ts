import { ConsentStatus, Prisma } from "@prisma/client";
import { UnprocessableEntityException } from "@nestjs/common";

import { AnalyticsBatchService } from "./analytics-batch.service";

function baseEvent(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    eventId: "11111111-1111-4111-8111-111111111111",
    eventName: "deck.opened",
    schemaVersion: 1,
    occurredAt: "2026-08-06T00:00:00.000Z",
    anonymousId: "a".repeat(20),
    sessionId: "s".repeat(10),
    context: {
      platform: "ios",
      appVersion: "1.0.0",
      build: "100",
      locale: "en",
    },
    properties: { deckType: "system" },
    ...overrides,
  };
}

function service(overrides: {
  findUnique?: jest.Mock;
  create?: jest.Mock;
}): AnalyticsBatchService {
  const database = {
    userPrivacySettings: {
      findUnique: overrides.findUnique ?? jest.fn().mockResolvedValue(null),
    },
    analyticsOutboxEvent: {
      create: overrides.create ?? jest.fn().mockResolvedValue(undefined),
    },
  };
  return new AnalyticsBatchService(database as never);
}

describe("AnalyticsBatchService", () => {
  it("accepts a registered event and writes it to the outbox", async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const batches = service({ create });

    const result = await batches.ingest(
      { payloadVersion: 1, events: [baseEvent()] },
      undefined,
    );

    expect(result.results).toEqual([
      { eventId: baseEvent().eventId, status: "ACCEPTED", rejectionCode: null },
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0] as [{ data: Record<string, unknown> }];
    const data = call[0].data;
    expect(data.eventName).toBe("deck.opened");
    expect(data.analyticsSubjectId).toBeNull();
  });

  it("rejects an event that is not in the registry", async () => {
    const batches = service({});
    const result = await batches.ingest(
      {
        payloadVersion: 1,
        events: [baseEvent({ eventName: "not.a.real.event" })],
      },
      undefined,
    );
    expect(result.results).toEqual([
      {
        eventId: baseEvent().eventId,
        status: "REJECTED",
        rejectionCode: "UNKNOWN_EVENT",
      },
    ]);
  });

  it("rejects an event missing a required registered property", async () => {
    const batches = service({});
    const result = await batches.ingest(
      { payloadVersion: 1, events: [baseEvent({ properties: {} })] },
      undefined,
    );
    expect(result.results).toEqual([
      {
        eventId: baseEvent().eventId,
        status: "REJECTED",
        rejectionCode: "SCHEMA_MISMATCH",
      },
    ]);
  });

  it("rejects an event with a property the registry does not declare", async () => {
    const batches = service({});
    const result = await batches.ingest(
      {
        payloadVersion: 1,
        events: [
          baseEvent({ properties: { deckType: "system", extra: "nope" } }),
        ],
      },
      undefined,
    );
    expect(result.results).toEqual([
      {
        eventId: baseEvent().eventId,
        status: "REJECTED",
        rejectionCode: "SCHEMA_MISMATCH",
      },
    ]);
  });

  it("rejects an event whose property uses an unregistered enum value", async () => {
    const batches = service({});
    const result = await batches.ingest(
      {
        payloadVersion: 1,
        events: [baseEvent({ properties: { deckType: "not-a-real-type" } })],
      },
      undefined,
    );
    expect(result.results).toEqual([
      {
        eventId: baseEvent().eventId,
        status: "REJECTED",
        rejectionCode: "SCHEMA_MISMATCH",
      },
    ]);
  });

  it("rejects a product-analytics event for a user who denied that consent category", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValue({ productAnalyticsStatus: ConsentStatus.DENIED });
    const batches = service({ findUnique });

    const result = await batches.ingest(
      { payloadVersion: 1, events: [baseEvent()] },
      "user-1",
    );

    expect(result.results).toEqual([
      {
        eventId: baseEvent().eventId,
        status: "REJECTED",
        rejectionCode: "CONSENT_DENIED",
      },
    ]);
  });

  it("never blocks an essential_operations event on consent, even when denied", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValue({ productAnalyticsStatus: ConsentStatus.DENIED });
    const create = jest.fn().mockResolvedValue(undefined);
    const batches = service({ findUnique, create });

    const result = await batches.ingest(
      {
        payloadVersion: 1,
        events: [
          baseEvent({
            eventId: "22222222-2222-4222-8222-222222222222",
            eventName: "sync.completed",
            properties: { result: "success", durationBucket: "under_1s" },
          }),
        ],
      },
      "user-1",
    );

    expect(result.results).toEqual([
      {
        eventId: "22222222-2222-4222-8222-222222222222",
        status: "ACCEPTED",
        rejectionCode: null,
      },
    ]);
  });

  it("treats a repeated eventId within the same batch as a duplicate", async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const batches = service({ create });

    const result = await batches.ingest(
      { payloadVersion: 1, events: [baseEvent(), baseEvent()] },
      undefined,
    );

    expect(result.results.map((r) => r.status)).toEqual([
      "ACCEPTED",
      "DUPLICATE",
    ]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("treats a database unique-constraint violation as a duplicate, not an error", async () => {
    const create = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const batches = service({ create });

    const result = await batches.ingest(
      { payloadVersion: 1, events: [baseEvent()] },
      undefined,
    );

    expect(result.results).toEqual([
      {
        eventId: baseEvent().eventId,
        status: "DUPLICATE",
        rejectionCode: null,
      },
    ]);
  });

  it("rejects a malformed batch envelope with a validation error", async () => {
    const batches = service({});
    await expect(
      batches.ingest(
        { payloadVersion: 1, events: [{ eventName: "deck.opened" }] },
        undefined,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });
});
