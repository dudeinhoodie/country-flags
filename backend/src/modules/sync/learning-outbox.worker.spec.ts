import { OutboxDeliveryStatus } from "@prisma/client";

import { LearningOutboxWorker } from "./learning-outbox.worker";

describe("LearningOutboxWorker", () => {
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
            id: "event-1",
            eventType: "learning.projection.updated",
            occurredAt: new Date(),
            payload: {},
            attemptCount: 5,
            leaseToken: "10000000-0000-4000-8000-000000000001",
          },
        ])
        .mockResolvedValueOnce([]),
      learningOutboxEvent: { updateMany },
    };
    const publisher = {
      publish: jest.fn().mockRejectedValue(new Error("provider unavailable")),
    };
    const logger = { warn: jest.fn() };
    const worker = new LearningOutboxWorker(
      database as never,
      logger as never,
      { report: jest.fn() } as never,
      publisher,
    );

    await expect(worker.drain()).resolves.toBe(1);
    const update = receivedUpdate as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(update.where).toEqual({
      id: "event-1",
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
      expect.objectContaining({ event: "learning_outbox_dead_lettered" }),
    );
  });
});
