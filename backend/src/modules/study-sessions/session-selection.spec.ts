import { CardLearningState, SelectionReason } from "@prisma/client";

import {
  isDue,
  type SessionCandidate,
  selectSessionCandidates,
  sessionPool,
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

  it("deals a learning card whose step is still ahead after the new ones", () => {
    // Answered a minute ago, due in ten: the schedule does not owe it yet,
    // and a sitting opened right after the last one must not open on it.
    const justAnswered: SessionCandidate = {
      learningCardId: "00000000-0000-4000-8000-000000000007",
      state: {
        state: CardLearningState.LEARNING,
        dueAt: new Date("2026-07-29T12:10:00.000Z"),
        lastReviewedAt: new Date("2026-07-29T11:59:00.000Z"),
        lapses: 0,
        stateVersion: 1,
      },
    };

    const selected = selectSessionCandidates(
      [justAnswered, ...candidates],
      7,
      "10000000-0000-4000-8000-000000000001",
      now,
    );

    expect(selected.map(({ reason }) => reason)).toEqual([
      SelectionReason.OVERDUE,
      SelectionReason.LEARNING,
      SelectionReason.NEW,
      SelectionReason.NEW,
      SelectionReason.NEW,
      SelectionReason.NEW,
      SelectionReason.LEARNING,
    ]);
    expect(selected[6]?.candidate.learningCardId).toBe(
      justAnswered.learningCardId,
    );
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

describe("isDue", () => {
  const now = new Date("2026-08-16T12:00:00Z");
  const candidate = (
    state: "NEW" | "LEARNING" | "REVIEW" | "RELEARNING" | null,
    dueAt: Date,
  ): SessionCandidate => ({
    learningCardId: "11111111-1111-4111-8111-111111111111",
    state:
      state === null
        ? null
        : {
            state: CardLearningState[state],
            dueAt,
            lastReviewedAt: null,
            lapses: 0,
            stateVersion: 1,
          },
  });

  it("owes a started card whose schedule has come round", () => {
    expect(
      isDue(candidate("REVIEW", new Date("2026-08-16T11:00:00Z")), now),
    ).toBe(true);
    expect(isDue(candidate("LEARNING", now), now)).toBe(true);
  });

  it("owes nothing for the future, the unseen and the new", () => {
    expect(
      isDue(candidate("REVIEW", new Date("2026-08-17T11:00:00Z")), now),
    ).toBe(false);
    expect(isDue(candidate("NEW", new Date("2026-08-16T11:00:00Z")), now)).toBe(
      false,
    );
    expect(isDue(candidate(null, now), now)).toBe(false);
  });
});

describe("sessionPool", () => {
  const now = new Date("2026-09-24T12:00:00.000Z");

  function card(
    suffix: number,
    state: CardLearningState | null,
    dueAt = "2026-09-01T00:00:00.000Z",
  ): SessionCandidate {
    return {
      learningCardId: `00000000-0000-4000-8000-${suffix
        .toString()
        .padStart(12, "0")}`,
      state:
        state === null
          ? null
          : {
              state,
              dueAt: new Date(dueAt),
              lastReviewedAt: new Date("2026-08-01T00:00:00.000Z"),
              lapses: 0,
              stateVersion: 2,
            },
    };
  }

  // Three owed, listed newest debt first so the pool has to reorder them; a
  // review not yet due; a learning step still ahead; two never studied.
  const owedLatest = card(1, CardLearningState.REVIEW, "2026-09-20T00:00:00Z");
  const owedOldest = card(2, CardLearningState.REVIEW, "2026-09-01T00:00:00Z");
  const owedLearning = card(
    3,
    CardLearningState.LEARNING,
    "2026-09-10T00:00:00Z",
  );
  const maintenance = card(4, CardLearningState.REVIEW, "2099-01-01T00:00:00Z");
  const stepAhead = card(5, CardLearningState.LEARNING, "2026-09-24T15:00:00Z");
  const unseen = card(6, null);
  const fresh = card(7, CardLearningState.NEW);
  const candidates = [
    owedLatest,
    owedOldest,
    owedLearning,
    maintenance,
    stepAhead,
    unseen,
    fresh,
  ];

  it("deals STANDARD no scheduled review once the day is spent", () => {
    const pool = sessionPool(candidates, "STANDARD", 0, now);

    expect(pool.filter((candidate) => isDue(candidate, now))).toEqual([]);
    // What is not a scheduled review is still there to study.
    expect(pool).toEqual([maintenance, stepAhead, unseen, fresh]);
    const reasons = selectSessionCandidates(
      pool,
      20,
      "10000000-0000-4000-8000-000000000001",
      now,
    ).map(({ reason }) => reason);
    expect(reasons).not.toContain(SelectionReason.OVERDUE);
    expect(reasons.slice(0, 2)).toEqual([
      SelectionReason.NEW,
      SelectionReason.NEW,
    ]);
    expect(new Set(reasons.slice(2))).toEqual(
      new Set([SelectionReason.MAINTENANCE, SelectionReason.LEARNING]),
    );
  });

  it("lets STANDARD deal only the oldest debt the day still allows", () => {
    const pool = sessionPool(candidates, "STANDARD", 2, now);

    expect(pool.filter((candidate) => isDue(candidate, now))).toEqual([
      owedOldest,
      owedLearning,
    ]);
    expect(pool).not.toContain(owedLatest);
    expect(pool).toHaveLength(candidates.length - 1);
  });

  it("leaves STANDARD whole while the day has room", () => {
    expect(sessionPool(candidates, "STANDARD", 50, now)).toEqual(candidates);
  });

  it("keeps DUE_ONLY to the owed cards, oldest first, within the day", () => {
    expect(sessionPool(candidates, "DUE_ONLY", 50, now)).toEqual([
      owedOldest,
      owedLearning,
      owedLatest,
    ]);
    expect(sessionPool(candidates, "DUE_ONLY", 1, now)).toEqual([owedOldest]);
    expect(sessionPool(candidates, "DUE_ONLY", 0, now)).toEqual([]);
  });
});
