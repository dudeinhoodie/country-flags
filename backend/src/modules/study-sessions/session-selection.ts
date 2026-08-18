import { createHash } from "node:crypto";

import { CardLearningState, SelectionReason } from "@prisma/client";

export interface SessionCandidate {
  learningCardId: string;
  state: {
    state: CardLearningState;
    dueAt: Date;
    lastReviewedAt: Date | null;
    lapses: number;
    stateVersion: number;
  } | null;
}

export interface SelectedCandidate<T extends SessionCandidate> {
  candidate: T;
  reason: SelectionReason;
}

function deterministicRank(sessionId: string, learningCardId: string): string {
  return createHash("sha256")
    .update(`${sessionId}:${learningCardId}`)
    .digest("hex");
}

/**
 * The reason a card belongs in a session, derived from the canonical card
 * state. An imported offline session reuses it so a client-assembled
 * composition is classified by the same rule as a server-selected one.
 */
export function selectionReasonFor(
  candidate: SessionCandidate,
  now: Date,
): SelectionReason {
  if (
    candidate.state === null ||
    candidate.state.state === CardLearningState.NEW
  ) {
    return SelectionReason.NEW;
  }
  if (
    candidate.state.state === CardLearningState.LEARNING ||
    candidate.state.state === CardLearningState.RELEARNING
  ) {
    return SelectionReason.LEARNING;
  }
  if (candidate.state.dueAt.getTime() <= now.getTime()) {
    return SelectionReason.OVERDUE;
  }

  return SelectionReason.MAINTENANCE;
}

/**
 * Whether the schedule has come round for this card — the same rule the
 * progress aggregate counts a card as due by: answered at least once, and
 * scheduled at or before now.
 */
export function isDue(candidate: SessionCandidate, now: Date): boolean {
  return (
    candidate.state !== null &&
    candidate.state.state !== CardLearningState.NEW &&
    candidate.state.dueAt.getTime() <= now.getTime()
  );
}

function priority(reason: SelectionReason): number {
  switch (reason) {
    case SelectionReason.OVERDUE:
      return 0;
    case SelectionReason.LEARNING:
      return 1;
    case SelectionReason.ERROR:
      return 2;
    case SelectionReason.NEW:
      return 3;
    case SelectionReason.MAINTENANCE:
      return 4;
  }
}

export function selectSessionCandidates<T extends SessionCandidate>(
  candidates: T[],
  requestedCount: number,
  sessionId: string,
  now: Date,
): Array<SelectedCandidate<T>> {
  return candidates
    .map((candidate) => ({
      candidate,
      reason: selectionReasonFor(candidate, now),
      randomRank: deterministicRank(sessionId, candidate.learningCardId),
    }))
    .sort((left, right) => {
      const priorityDifference = priority(left.reason) - priority(right.reason);
      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      if (
        left.reason === SelectionReason.OVERDUE ||
        left.reason === SelectionReason.LEARNING
      ) {
        const dueDifference =
          (left.candidate.state?.dueAt.getTime() ?? 0) -
          (right.candidate.state?.dueAt.getTime() ?? 0);
        if (dueDifference !== 0) {
          return dueDifference;
        }
        const lapseDifference =
          (right.candidate.state?.lapses ?? 0) -
          (left.candidate.state?.lapses ?? 0);
        if (lapseDifference !== 0) {
          return lapseDifference;
        }
      }

      const randomDifference = left.randomRank.localeCompare(right.randomRank);
      return randomDifference !== 0
        ? randomDifference
        : left.candidate.learningCardId.localeCompare(
            right.candidate.learningCardId,
          );
    })
    .slice(0, requestedCount)
    .map(({ candidate, reason }) => ({ candidate, reason }));
}
