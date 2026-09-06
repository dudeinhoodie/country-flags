import { PublishRunKind, type PublishRun } from "@prisma/client";

/**
 * The stages a run reports as it goes.
 *
 * They exist for the screen watching the run, so they are named after what
 * an operator is waiting for rather than after the function running: a
 * publish that sits on `applying` for eight minutes is a long transaction,
 * and one that sits on `building` is a slow rasteriser.
 */
export const PUBLISH_STAGES = {
  claimed: "claimed",
  building: "building",
  signing: "signing",
  applying: "applying",
  restoring: "restoring",
  done: "done",
} as const;

/**
 * A failure with a code the console can show without reading the message.
 *
 * Everything else that escapes is reported as `PUBLISH_RUN_FAILED`: an
 * unexpected error is unexpected, and inventing a code for it would suggest
 * somebody had thought about that case.
 */
export class PublishRunFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PublishRunFailure";
  }
}

/**
 * The run record, as the executor needs to touch it.
 *
 * A port rather than Prisma directly, because the interesting part of this
 * file is the order things happen in and the states a run can be left in —
 * and that should be testable without a database.
 */
export interface PublishRunStore {
  /**
   * Moves one queued run to `RUNNING` and returns it, or null when there is
   * nothing to take.
   *
   * The transition is the claim: two executors that both saw the same queued
   * run must not both get it back, so this is a conditional update rather
   * than a read followed by a write.
   */
  claim(
    runId: string | null,
    executionName: string | null,
  ): Promise<PublishRun | null>;
  recordStage(runId: string, stage: string): Promise<void>;
  recordSuccess(runId: string): Promise<void>;
  recordFailure(runId: string, code: string, message: string): Promise<void>;
}

/** What actually applies a release. */
export interface ReleaseWork {
  /** Builds, signs and applies the release the run names. */
  publish(
    run: PublishRun,
    stage: (stage: string) => Promise<void>,
  ): Promise<void>;
  /** Returns the active pointer to a release that was already published. */
  rollback(
    run: PublishRun,
    stage: (stage: string) => Promise<void>,
  ): Promise<void>;
}

export type PublishRunOutcome =
  | { taken: false }
  | { taken: true; run: PublishRun; succeeded: boolean };

/**
 * A failure message is stored and shown, so it is bounded here rather than
 * wherever it came from. Postgres would take the whole thing; a screen would
 * not, and a stack trace pasted into a red box helps nobody.
 */
const MAX_FAILURE_MESSAGE = 2000;

function failureOf(error: unknown): { code: string; message: string } {
  if (error instanceof PublishRunFailure) {
    return {
      code: error.code,
      message: error.message.slice(0, MAX_FAILURE_MESSAGE),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: "PUBLISH_RUN_FAILED",
    message: message.slice(0, MAX_FAILURE_MESSAGE),
  };
}

/**
 * Runs one queued release run to its end (ADR-017 §2).
 *
 * This is the whole of the executor's contract with the rest of the system:
 * it takes a run that a request created, does the work the console cannot do
 * inside an HTTP request, and leaves the row saying what happened. Nothing
 * here decides whether a run *should* happen — the refusals belong to the
 * endpoint, which can answer a person.
 *
 * Finding nothing to take is a success. A job started for a run that was
 * cancelled in the meantime, or started twice by a retry, has nothing to do
 * and should say so by exiting cleanly rather than by failing something.
 */
export async function executePublishRun(
  store: PublishRunStore,
  work: ReleaseWork,
  options: {
    runId?: string | undefined;
    executionName?: string | undefined;
  } = {},
): Promise<PublishRunOutcome> {
  const run = await store.claim(
    options.runId ?? null,
    options.executionName ?? null,
  );
  if (run === null) {
    return { taken: false };
  }

  const stage = async (name: string): Promise<void> => {
    await store.recordStage(run.id, name);
  };

  try {
    if (run.kind === PublishRunKind.PUBLISH) {
      await work.publish(run, stage);
    } else {
      await work.rollback(run, stage);
    }
    await store.recordSuccess(run.id);
    return { taken: true, run, succeeded: true };
  } catch (error: unknown) {
    const { code, message } = failureOf(error);
    // Recording the failure must not itself throw the original away: if the
    // database is what broke, the process still has to exit non-zero with
    // something an operator can read.
    await store.recordFailure(run.id, code, message).catch(() => undefined);
    return { taken: true, run, succeeded: false };
  }
}
