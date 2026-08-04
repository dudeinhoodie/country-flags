import type { Prisma } from "@prisma/client";

export const LEARNING_EVENT_PUBLISHER = Symbol("LEARNING_EVENT_PUBLISHER");

export interface LearningEventEnvelope {
  id: string;
  eventType: string;
  occurredAt: Date;
  payload: Prisma.JsonValue;
}

export interface LearningEventPublisher {
  publish(event: LearningEventEnvelope): Promise<void>;
}

export class NoOpLearningEventPublisher implements LearningEventPublisher {
  publish(event: LearningEventEnvelope): Promise<void> {
    void event;
    return Promise.resolve();
  }
}
