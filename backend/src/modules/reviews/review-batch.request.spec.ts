import { AnswerMode, ReviewRating } from "@prisma/client";

import {
  parseReviewBatchRequest,
  reviewPayloadHash,
} from "./review-batch.request";

describe("review batch request", () => {
  const event = {
    id: "92000000-0000-4000-8000-000000000001",
    sessionId: "90000000-0000-4000-8000-000000000001",
    learningCardId: "60000000-0000-4000-8000-000000000001",
    deviceId: "81000000-0000-4000-8000-000000000001",
    answerMode: AnswerMode.SELF_RATED,
    rating: ReviewRating.GOOD,
    responseTimeMs: 4200,
    clientOccurredAt: "2026-07-29T10:15:30.000Z",
    estimatedServerOccurredAt: "2026-07-29T10:15:28.000Z",
    clientSequence: 12,
    baseStateVersion: 0,
  };

  it("parses and hashes semantically identical payloads deterministically", () => {
    const first = parseReviewBatchRequest({
      payloadVersion: 1,
      events: [event],
    });
    const second = parseReviewBatchRequest({
      events: [{ ...event }],
      payloadVersion: 1,
    });

    expect(reviewPayloadHash(1, first.events[0]!)).toBe(
      reviewPayloadHash(1, second.events[0]!),
    );
  });

  it("rejects extra and mode-specific client grading fields", () => {
    expect(() =>
      parseReviewBatchRequest({
        payloadVersion: 1,
        events: [{ ...event, isCorrect: true }],
      }),
    ).toThrow("unknown field isCorrect");

    expect(() =>
      parseReviewBatchRequest({
        payloadVersion: 1,
        events: [
          {
            ...event,
            answerMode: AnswerMode.MULTIPLE_CHOICE,
            selectedOptionId: "93000000-0000-4000-8000-000000000001",
            rating: ReviewRating.GOOD,
          },
        ],
      }),
    ).toThrow("unknown field rating");
  });

  it("accepts the two answers a swipe can produce", () => {
    for (const rating of [ReviewRating.AGAIN, ReviewRating.GOOD]) {
      const parsed = parseReviewBatchRequest({
        payloadVersion: 1,
        events: [{ ...event, rating }],
      });

      expect(parsed.events[0]).toMatchObject({ rating });
    }
  });

  // The study screen answers a card with a swipe in one of two directions, so
  // a request carrying HARD or EASY describes an answer no learner could have
  // given. Stored reviews keep all four — history is immutable — but nothing
  // may write a new one.
  it("rejects the grades the study screen cannot produce", () => {
    for (const rating of [ReviewRating.HARD, ReviewRating.EASY]) {
      expect(() =>
        parseReviewBatchRequest({
          payloadVersion: 1,
          events: [{ ...event, rating }],
        }),
      ).toThrow("events[0].rating is invalid");
    }
  });
});
