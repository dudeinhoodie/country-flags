import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ReviewRating } from "@prisma/client";

import {
  FSRS6_DEFAULT_PARAMETERS,
  FSRS6_PARAMETERS_V2,
  FSRS6_PARAMETERS_V3,
  FSRS_PACKAGE_NAME,
  FSRS_PACKAGE_VERSION,
  Fsrs6SchedulerAdapter,
} from "./fsrs6-scheduler.adapter";
import type { SchedulerCardState } from "./scheduler";

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
