import { CardLearningState, SelectionReason } from "@prisma/client";

import {
  type SessionCandidate,
  selectSessionCandidates,
} from "./session-selection";

describe("selectSessionCandidates", () => {
  const now = new Date("2026-07-29T12:00:00.000Z");
  const candidates: SessionCandidate[] = [
    {
      learningCardId: "00000000-0000-4000-8000-000000000001",
      state: {
        state: CardLearningState.REVIEW,
        dueAt: new Date("2026-07-01T00:00:00.000Z"),
        lastReviewedAt: new Date("2026-06-01T00:00:00.000Z"),
        lapses: 1,
        stateVersion: 2,
      },
    },
    {
      learningCardId: "00000000-0000-4000-8000-000000000002",
      state: {
        state: CardLearningState.LEARNING,
        dueAt: new Date("2026-07-20T00:00:00.000Z"),
        lastReviewedAt: new Date("2026-07-19T00:00:00.000Z"),
        lapses: 0,
        stateVersion: 1,
      },
    },
    ...[3, 4, 5, 6].map((suffix) => ({
      learningCardId: `00000000-0000-4000-8000-${suffix
        .toString()
        .padStart(12, "0")}`,
      state: null,
    })),
  ];

  it("prioritizes overdue and learning, then fills with unique new cards", () => {
    const selected = selectSessionCandidates(
      candidates,
      5,
      "10000000-0000-4000-8000-000000000001",
      now,
    );

    expect(selected.map(({ reason }) => reason)).toEqual([
      SelectionReason.OVERDUE,
      SelectionReason.LEARNING,
      SelectionReason.NEW,
      SelectionReason.NEW,
      SelectionReason.NEW,
    ]);
    expect(
      new Set(selected.map(({ candidate }) => candidate.learningCardId)).size,
    ).toBe(5);
  });

  it("is reproducible for one session seed", () => {
    const first = selectSessionCandidates(
      candidates,
      5,
      "10000000-0000-4000-8000-000000000002",
      now,
    );
    const second = selectSessionCandidates(
      [...candidates].reverse(),
      5,
      "10000000-0000-4000-8000-000000000002",
      now,
    );

    expect(second).toEqual(first);
  });

  it("varies the new-card order for another session seed", () => {
    const first = selectSessionCandidates(
      candidates,
      5,
      "10000000-0000-4000-8000-000000000002",
      now,
    );
    const another = selectSessionCandidates(
      candidates,
      5,
      "10000000-0000-4000-8000-000000000004",
      now,
    );

    expect(
      another.slice(2).map(({ candidate }) => candidate.learningCardId),
    ).not.toEqual(
      first.slice(2).map(({ candidate }) => candidate.learningCardId),
    );
  });
});
