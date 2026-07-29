import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ReviewRating } from "@prisma/client";

import {
  FSRS6_DEFAULT_PARAMETERS,
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

describe("Fsrs6SchedulerAdapter", () => {
  const fixture = JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        "../../../../contracts/fixtures/scheduler/fsrs-6-default-v1.json",
      ),
      "utf8",
    ),
  ) as GoldenFixture;
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
