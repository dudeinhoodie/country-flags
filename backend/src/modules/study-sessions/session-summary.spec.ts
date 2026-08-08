import { ReviewRating } from "@prisma/client";

import {
  buildSessionSummary,
  effectiveCompletedAt,
  effectiveStartedAt,
} from "./session-summary";

const startedAt = new Date("2026-07-29T10:00:00.000Z");

describe("buildSessionSummary", () => {
  it("counts unique cards, correctness and every rating bucket", () => {
    const summary = buildSessionSummary({
      events: [
        {
          learningCardId: "card-a",
          rating: ReviewRating.GOOD,
          isCorrect: true,
        },
        {
          learningCardId: "card-a",
          rating: ReviewRating.AGAIN,
          isCorrect: false,
        },
        {
          learningCardId: "card-b",
          rating: ReviewRating.EASY,
          isCorrect: true,
        },
        {
          learningCardId: "card-c",
          rating: ReviewRating.HARD,
          isCorrect: true,
        },
      ],
      startedAt,
      completedAt: new Date("2026-07-29T10:02:30.400Z"),
    });

    expect(summary).toEqual({
      uniqueCardCount: 3,
      reviewCount: 4,
      correctCount: 3,
      incorrectCount: 1,
      durationSeconds: 150,
      ratings: { again: 1, hard: 1, good: 1, easy: 1 },
    });
  });

  it("describes an abandoned-but-completed session without reviews", () => {
    expect(
      buildSessionSummary({
        events: [],
        startedAt,
        completedAt: startedAt,
      }),
    ).toEqual({
      uniqueCardCount: 0,
      reviewCount: 0,
      correctCount: 0,
      incorrectCount: 0,
      durationSeconds: 0,
      ratings: { again: 0, hard: 0, good: 0, easy: 0 },
    });
  });
});

describe("effectiveStartedAt", () => {
  const receivedAt = new Date("2026-07-29T10:05:00.000Z");

  it("keeps the instant an offline session really started", () => {
    const clientStartedAt = new Date("2026-07-29T08:00:00.000Z");
    expect(effectiveStartedAt({ clientStartedAt, receivedAt })).toEqual(
      clientStartedAt,
    );
  });

  it("tolerates the same small forward skew as review ingestion", () => {
    const slightlyAhead = new Date(receivedAt.getTime() + 60_000);
    expect(
      effectiveStartedAt({ clientStartedAt: slightlyAhead, receivedAt }),
    ).toEqual(slightlyAhead);
  });

  it("bounds a device clock running far ahead of the server", () => {
    expect(
      effectiveStartedAt({
        clientStartedAt: new Date("2027-07-29T10:00:00.000Z"),
        receivedAt,
      }),
    ).toEqual(receivedAt);
  });
});

describe("effectiveCompletedAt", () => {
  const receivedAt = new Date("2026-07-29T10:05:00.000Z");

  it("keeps a plausible client instant", () => {
    const completedAt = new Date("2026-07-29T10:04:00.000Z");
    expect(
      effectiveCompletedAt({
        clientCompletedAt: completedAt,
        startedAt,
        receivedAt,
      }),
    ).toEqual(completedAt);
  });

  it("never reports completion before the session started", () => {
    expect(
      effectiveCompletedAt({
        clientCompletedAt: new Date("2026-07-29T09:00:00.000Z"),
        startedAt,
        receivedAt,
      }),
    ).toEqual(startedAt);
  });

  it("tolerates the same small forward skew as review ingestion", () => {
    const slightlyAhead = new Date(receivedAt.getTime() + 60_000);
    expect(
      effectiveCompletedAt({
        clientCompletedAt: slightlyAhead,
        startedAt,
        receivedAt,
      }),
    ).toEqual(slightlyAhead);
  });

  it("bounds a device clock running far ahead of the server", () => {
    expect(
      effectiveCompletedAt({
        clientCompletedAt: new Date("2027-07-29T10:00:00.000Z"),
        startedAt,
        receivedAt,
      }),
    ).toEqual(receivedAt);
  });

  it("prefers the start instant when the session started after the request arrived", () => {
    expect(
      effectiveCompletedAt({
        clientCompletedAt: new Date("2026-07-29T09:30:00.000Z"),
        startedAt,
        receivedAt: new Date("2026-07-29T09:59:00.000Z"),
      }),
    ).toEqual(startedAt);
  });
});
