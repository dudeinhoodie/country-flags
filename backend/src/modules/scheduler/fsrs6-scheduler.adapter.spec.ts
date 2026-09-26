import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ReviewRating } from "@prisma/client";

import {
  FSRS6_DEFAULT_PARAMETERS,
  FSRS6_PARAMETERS_V2,
  FSRS6_PARAMETERS_V3,
  FSRS6_PARAMETERS_V4,
  FSRS_PACKAGE_NAME,
  FSRS_PACKAGE_VERSION,
  FSRS_PARAMETERS_VERSION_V3,
  FSRS_PARAMETERS_VERSION_V4,
  Fsrs6SchedulerAdapter,
} from "./fsrs6-scheduler.adapter";
import type { SchedulerCardState, SchedulerDefinitionData } from "./scheduler";

interface GoldenFixture {
  schedulerVersion: string;
  parametersVersion: string;
  reviews: Array<{
    occurredAt: string;
    rating: ReviewRating;
    expected: {
      state: string;
      difficulty: number;
      stability: number;
      retrievabilityAtReview: number | null;
      dueAt: string;
      repetitions: number;
      lapses: number;
      /// Only the fixtures written since the step is stored carry it; the
      /// earlier ones are immutable and replay under definitions that ignore
      /// it on the way in.
      learningStep?: number;
    };
  }>;
}

function goldenFixture(name: string): GoldenFixture {
  return JSON.parse(
    readFileSync(
      resolve(__dirname, `../../../../contracts/fixtures/scheduler/${name}`),
      "utf8",
    ),
  ) as GoldenFixture;
}

describe("Fsrs6SchedulerAdapter", () => {
  const fixture = goldenFixture("fsrs-6-default-v1.json");
  const definition = {
    version: fixture.schedulerVersion,
    algorithmMajor: 6,
    packageName: FSRS_PACKAGE_NAME,
    packageVersion: FSRS_PACKAGE_VERSION,
    parametersVersion: fixture.parametersVersion,
    parameters: FSRS6_DEFAULT_PARAMETERS,
    defaultDesiredRetention: 0.9,
  };

  it("matches the pinned FSRS-6 golden sequence", () => {
    const adapter = new Fsrs6SchedulerAdapter();
    let state: SchedulerCardState | null = null;

    for (const review of fixture.reviews) {
      state = adapter.applyReview(
        state,
        {
          rating: review.rating,
          occurredAt: new Date(review.occurredAt),
        },
        definition,
      );
      expect({
        state: state.state,
        difficulty: state.difficulty,
        stability: state.stability,
        retrievabilityAtReview: state.retrievabilityAtReview,
        dueAt: state.dueAt.toISOString(),
        repetitions: state.repetitions,
        lapses: state.lapses,
      }).toEqual(review.expected);
    }
  });

  /// The parameters that moved the first step from a minute to an hour. It is
  /// a separate fixture rather than an edit of the first one: the reviews
  /// already accepted under v1 replay under v1 forever, and a fixture that
  /// changed underneath them would prove nothing about either.
  it("matches the pinned FSRS-6 golden sequence for the slower first step", () => {
    const slowFixture = goldenFixture("fsrs-6-default-v2.json");
    const slowDefinition = {
      version: slowFixture.schedulerVersion,
      algorithmMajor: 6,
      packageName: FSRS_PACKAGE_NAME,
      packageVersion: FSRS_PACKAGE_VERSION,
      parametersVersion: slowFixture.parametersVersion,
      parameters: FSRS6_PARAMETERS_V2,
      defaultDesiredRetention: 0.9,
    };
    const adapter = new Fsrs6SchedulerAdapter();
    let state: SchedulerCardState | null = null;

    for (const review of slowFixture.reviews) {
      state = adapter.applyReview(
        state,
        { rating: review.rating, occurredAt: new Date(review.occurredAt) },
        slowDefinition,
      );
      expect({
        state: state.state,
        difficulty: state.difficulty,
        stability: state.stability,
        retrievabilityAtReview: state.retrievabilityAtReview,
        dueAt: state.dueAt.toISOString(),
        repetitions: state.repetitions,
        lapses: state.lapses,
      }).toEqual(review.expected);
    }
  });

  /// The parameters that raised the first rung from an hour to three
  /// (ADR-022). The same four answers as the v2 fixture, replayed through the
  /// adapter under the new ladder: what changes is when "again" and "hard"
  /// come back, and nothing else.
  it("matches the pinned FSRS-6 golden sequence for the three-hour floor", () => {
    const floorFixture = goldenFixture("fsrs-6-default-v3.json");
    const floorDefinition = {
      version: floorFixture.schedulerVersion,
      algorithmMajor: 6,
      packageName: FSRS_PACKAGE_NAME,
      packageVersion: FSRS_PACKAGE_VERSION,
      parametersVersion: floorFixture.parametersVersion,
      parameters: FSRS6_PARAMETERS_V3,
      defaultDesiredRetention: 0.9,
    };
    const adapter = new Fsrs6SchedulerAdapter();
    let state: SchedulerCardState | null = null;

    for (const review of floorFixture.reviews) {
      state = adapter.applyReview(
        state,
        { rating: review.rating, occurredAt: new Date(review.occurredAt) },
        floorDefinition,
      );
      expect({
        state: state.state,
        difficulty: state.difficulty,
        stability: state.stability,
        retrievabilityAtReview: state.retrievabilityAtReview,
        dueAt: state.dueAt.toISOString(),
        repetitions: state.repetitions,
        lapses: state.lapses,
      }).toEqual(review.expected);
    }
  });

  /// The point of the change, stated as a test: nothing comes back inside
  /// three hours. Written against the ladder rather than against one
  /// sequence, so a future edit to the steps that reintroduces an hour — or a
  /// minute — fails here.
  it("never brings a card back sooner than three hours", () => {
    const adapter = new Fsrs6SchedulerAdapter();
    const slowDefinition = {
      version: "fsrs-6-floor",
      algorithmMajor: 6,
      packageName: FSRS_PACKAGE_NAME,
      packageVersion: FSRS_PACKAGE_VERSION,
      parametersVersion: "fsrs-6-default-21-v3",
      parameters: FSRS6_PARAMETERS_V3,
      defaultDesiredRetention: 0.9,
    };
    const threeHours = 3 * 3_600_000;
    const occurredAt = new Date("2026-02-01T00:00:00.000Z");

    for (const rating of [
      ReviewRating.AGAIN,
      ReviewRating.HARD,
      ReviewRating.GOOD,
      ReviewRating.EASY,
    ]) {
      const state = adapter.applyReview(
        null,
        { rating, occurredAt },
        slowDefinition,
      );
      expect(
        state.dueAt.getTime() - occurredAt.getTime(),
      ).toBeGreaterThanOrEqual(threeHours);
    }
  });

  describe("the learning step (ADR-026)", () => {
    const v3Definition: SchedulerDefinitionData = {
      version: "fsrs-6-test-v3",
      algorithmMajor: 6,
      packageName: FSRS_PACKAGE_NAME,
      packageVersion: FSRS_PACKAGE_VERSION,
      parametersVersion: FSRS_PARAMETERS_VERSION_V3,
      parameters: FSRS6_PARAMETERS_V3,
      defaultDesiredRetention: 0.9,
    };
    const v4Definition: SchedulerDefinitionData = {
      ...v3Definition,
      version: "fsrs-6-test-v4",
      parametersVersion: FSRS_PARAMETERS_VERSION_V4,
      parameters: FSRS6_PARAMETERS_V4,
    };
    const hour = 3_600_000;

    function replayFixture(name: string): void {
      const fixture = goldenFixture(name);
      expect(fixture.parametersVersion).toBe(FSRS_PARAMETERS_VERSION_V4);
      const adapter = new Fsrs6SchedulerAdapter();
      let state: SchedulerCardState | null = null;
      for (const review of fixture.reviews) {
        state = adapter.applyReview(
          state,
          { rating: review.rating, occurredAt: new Date(review.occurredAt) },
          { ...v4Definition, version: fixture.schedulerVersion },
        );
        expect({
          state: state.state,
          difficulty: state.difficulty,
          stability: state.stability,
          retrievabilityAtReview: state.retrievabilityAtReview,
          dueAt: state.dueAt.toISOString(),
          repetitions: state.repetitions,
          lapses: state.lapses,
          learningStep: state.learningStep,
        }).toEqual(review.expected);
      }
    }

    /// The defect, stated as the fixture the iOS projection replays too:
    /// two `GOOD` answers graduate a new card — three hours, then a day in
    /// `REVIEW` — and the intervals grow from there.
    it("graduates a new card on its second GOOD and grows the interval after", () => {
      replayFixture("fsrs-6-default-v4.json");
      const fixture = goldenFixture("fsrs-6-default-v4.json");
      const hoursOut = fixture.reviews.map(
        ({ occurredAt, expected }) =>
          (Date.parse(expected.dueAt) - Date.parse(occurredAt)) / hour,
      );
      expect(hoursOut.slice(0, 5)).toEqual([3, 24, 168, 768, 2832]);
      expect(fixture.reviews.map(({ expected }) => expected.state)).toEqual([
        "LEARNING",
        ...Array<string>(7).fill("REVIEW"),
      ]);
    });

    /// The other rungs a swipe reaches: `AGAIN` back to the first rung, the
    /// day-long rung, a lapse, relearning and graduating out of it.
    it("carries the step through AGAIN, a lapse and relearning", () => {
      replayFixture("fsrs-6-default-v4-again.json");
    });

    /// The reference is ts-fsrs itself, handed back the whole card it
    /// returned — which is what the adapter must be equivalent to, now that
    /// the step is stored. Every sequence of eight swipes, each answered when
    /// the card falls due. Difficulty and stability are stored to six decimals
    /// and the reference keeps them whole, so those two are compared loosely;
    /// everything a learner can see is compared exactly.
    it("matches ts-fsrs 5.4.1 carrying the whole card for every eight-answer swipe sequence", () => {
      // The adapter is the only production importer of ts-fsrs; the test
      // needs the package itself as the reference it is checked against.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const reference = require("ts-fsrs") as {
        createEmptyCard(now: Date): Record<string, unknown>;
        fsrs(parameters: Record<string, unknown>): {
          next(
            card: Record<string, unknown>,
            now: Date,
            rating: number,
          ): {
            card: {
              due: Date;
              state: number;
              stability: number;
              difficulty: number;
              reps: number;
              lapses: number;
              learning_steps: number;
            };
          };
        };
      };
      const scheduler = reference.fsrs({ ...FSRS6_PARAMETERS_V4 });
      const states = ["NEW", "LEARNING", "REVIEW", "RELEARNING"];
      const adapter = new Fsrs6SchedulerAdapter();
      const start = new Date("2026-01-01T00:00:00.000Z");

      for (let mask = 0; mask < 2 ** 8; mask += 1) {
        const ratings = Array.from({ length: 8 }, (_, index) =>
          (mask >> index) & 1 ? ReviewRating.GOOD : ReviewRating.AGAIN,
        );
        let card: Record<string, unknown> = reference.createEmptyCard(start);
        let state: SchedulerCardState | null = null;
        let now = start;
        for (const rating of ratings) {
          const expected = scheduler.next(
            card,
            now,
            rating === ReviewRating.GOOD ? 3 : 1,
          ).card;
          state = adapter.applyReview(
            state,
            { rating, occurredAt: now },
            v4Definition,
          );
          expect({
            ratings: ratings.join(","),
            state: state.state,
            dueAt: state.dueAt.toISOString(),
            repetitions: state.repetitions,
            lapses: state.lapses,
            learningStep: state.learningStep,
          }).toEqual({
            ratings: ratings.join(","),
            state: states[expected.state],
            dueAt: expected.due.toISOString(),
            repetitions: expected.reps,
            lapses: expected.lapses,
            learningStep: expected.learning_steps,
          });
          // Four decimals rather than six: the stored rounding compounds over
          // eight answers — by at most 3e-5 across this whole space — and
          // still lands every card on the same instant.
          expect(state.difficulty).toBeCloseTo(expected.difficulty, 4);
          expect(state.stability).toBeCloseTo(expected.stability, 4);
          card = expected;
          now = expected.due;
        }
      }
    });

    /// ADR-004 from the other side: reviews accepted under v3 were scheduled
    /// with the step dropped, and they must replay to the due dates the
    /// learner was shown. The step ts-fsrs returned is still recorded, which
    /// is what lets a migrated card pick up where it stood.
    it("replays v3 history exactly as it was scheduled, recording the step", () => {
      const adapter = new Fsrs6SchedulerAdapter();
      let state: SchedulerCardState | null = null;
      let occurredAt = new Date("2026-01-01T00:00:00.000Z");
      for (let answer = 0; answer < 4; answer += 1) {
        state = adapter.applyReview(
          state,
          { rating: ReviewRating.GOOD, occurredAt },
          v3Definition,
        );
        expect(state.state).toBe("LEARNING");
        expect(state.dueAt.getTime() - occurredAt.getTime()).toBe(3 * hour);
        expect(state.learningStep).toBe(1);
        occurredAt = state.dueAt;
      }
    });

    it("graduates a card migrated from v3 on its next GOOD", () => {
      const adapter = new Fsrs6SchedulerAdapter();
      let state: SchedulerCardState | null = null;
      let occurredAt = new Date("2026-01-01T00:00:00.000Z");
      for (let answer = 0; answer < 3; answer += 1) {
        state = adapter.applyReview(
          state,
          { rating: ReviewRating.GOOD, occurredAt },
          v3Definition,
        );
        occurredAt = state.dueAt;
      }
      const migrated = adapter.applyReview(
        state,
        { rating: ReviewRating.GOOD, occurredAt },
        v4Definition,
      );
      expect(migrated.state).toBe("REVIEW");
      expect(migrated.dueAt.getTime() - occurredAt.getTime()).toBe(24 * hour);
      expect(migrated.learningStep).toBe(2);
    });

    it("refuses a state whose learning step is not a rung", () => {
      const adapter = new Fsrs6SchedulerAdapter();
      const state = adapter.applyReview(
        null,
        {
          rating: ReviewRating.GOOD,
          occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        v4Definition,
      );
      expect(() =>
        adapter.applyReview(
          { ...state, learningStep: -1 },
          { rating: ReviewRating.GOOD, occurredAt: state.dueAt },
          v4Definition,
        ),
      ).toThrow("learning step");
    });
  });

  it("rejects an unregistered package version", () => {
    expect(() =>
      new Fsrs6SchedulerAdapter().applyReview(
        null,
        { rating: ReviewRating.GOOD, occurredAt: new Date() },
        { ...definition, packageVersion: "5.4.2" },
      ),
    ).toThrow("Unsupported scheduler definition");
  });
});
