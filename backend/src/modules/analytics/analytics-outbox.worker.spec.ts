import { OutboxDeliveryStatus } from "@prisma/client";

import { AnalyticsOutboxWorker } from "./analytics-outbox.worker";

describe("AnalyticsOutboxWorker", () => {
  it("dead-letters a repeatedly failing event with lease fencing", async () => {
    let receivedUpdate: unknown;
    const updateMany = jest.fn((update: unknown) => {
      receivedUpdate = update;
      return Promise.resolve({ count: 1 });
    });
    const database = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            eventId: "event-1",
            eventName: "deck.opened",
            schemaVersion: 1,
            occurredAt: new Date(),
            analyticsSubjectId: null,
            anonymousId: "a".repeat(20),
            consentCategory: "PRODUCT_ANALYTICS",
            properties: {},
            context: {},
            attemptCount: 5,
            leaseToken: "10000000-0000-4000-8000-000000000001",
          },
        ])
        .mockResolvedValueOnce([]),
      analyticsOutboxEvent: {
        updateMany,
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn(),
      },
    };
    const exporter = {
      publish: jest.fn().mockRejectedValue(new Error("provider unavailable")),
    };
    const logger = { warn: jest.fn() };
    const metricsService = { recordOutboxDepth: jest.fn() };
    const worker = new AnalyticsOutboxWorker(
      database as never,
      logger as never,
      metricsService as never,
      exporter,
    );

    await expect(worker.drain()).resolves.toBe(1);
    const update = receivedUpdate as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(update.where).toEqual({
      eventId: "event-1",
      deliveryStatus: OutboxDeliveryStatus.PROCESSING,
      leaseToken: "10000000-0000-4000-8000-000000000001",
    });
    expect(update.data).toMatchObject({
      deliveryStatus: OutboxDeliveryStatus.FAILED,
      leaseToken: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "analytics_outbox_dead_lettered" }),
    );
  });

  it("marks a delivered event without touching a lease it no longer holds", async () => {
    let receivedUpdate: unknown;
    const updateMany = jest.fn((update: unknown) => {
      receivedUpdate = update;
      return Promise.resolve({ count: 1 });
    });
    const database = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            eventId: "event-2",
            eventName: "deck.opened",
            schemaVersion: 1,
            occurredAt: new Date(),
            analyticsSubjectId: null,
            anonymousId: "a".repeat(20),
            consentCategory: "PRODUCT_ANALYTICS",
            properties: {},
            context: {},
            attemptCount: 1,
            leaseToken: "10000000-0000-4000-8000-000000000002",
          },
        ])
        .mockResolvedValueOnce([]),
      analyticsOutboxEvent: {
        updateMany,
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn(),
      },
    };
    const exporter = { publish: jest.fn().mockResolvedValue(undefined) };
    const worker = new AnalyticsOutboxWorker(
      database as never,
      { warn: jest.fn() } as never,
      { recordOutboxDepth: jest.fn() } as never,
      exporter,
    );

    await expect(worker.drain()).resolves.toBe(1);
    expect(exporter.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "event-2" }),
    );
    const update = receivedUpdate as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(update.where).toEqual({
      eventId: "event-2",
      deliveryStatus: OutboxDeliveryStatus.PROCESSING,
      leaseToken: "10000000-0000-4000-8000-000000000002",
    });
    expect(update.data).toMatchObject({
      deliveryStatus: OutboxDeliveryStatus.DELIVERED,
    });
  });
});
