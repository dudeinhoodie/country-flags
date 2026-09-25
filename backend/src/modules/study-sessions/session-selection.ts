import { createHash } from "node:crypto";

import { CardLearningState, SelectionReason } from "@prisma/client";

import type { SessionComposition } from "./study-session.request";

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

/**
 * The cards a server session may be dealt from, once the day's ceiling has
 * had its say.
 *
 * The ceiling binds every composition that deals scheduled reviews, not only
 * DUE_ONLY. It used to trim the due-only pool alone, and STANDARD — the
 * default, and the one the app falls back to when a due-only launch finds
 * nothing — dealt the rest of the backlog first, so the cap stopped holding at
 * exactly the moment it existed for (#438).
 *
 * What the day still allows is taken oldest debt first, the order the
 * progress aggregate cuts today's queue in. The due cards past it are not
 * forgiven and not dealt either: they stay owed and come back tomorrow.
 *
 * STANDARD keeps what is not a scheduled review — new cards and cards whose
 * next step has not come round. Studying past the day is allowed; it is just
 * not dressed as the scheduled queue (#431). DUE_ONLY is the owed cards and
 * nothing else, however few the day leaves.
 */
export function sessionPool<T extends SessionCandidate>(
  candidates: readonly T[],
  composition: SessionComposition,
  allowance: number,
  now: Date,
): T[] {
  const owedToday = candidates
    .filter((candidate) => isDue(candidate, now))
    .sort(
      (left, right) =>
        (left.state?.dueAt.getTime() ?? 0) -
        (right.state?.dueAt.getTime() ?? 0),
    )
    .slice(0, Math.max(0, allowance));
  if (composition === "DUE_ONLY") {
    return owedToday;
  }
  const dealt = new Set<T>(owedToday);
  return candidates.filter(
    (candidate) => !isDue(candidate, now) || dealt.has(candidate),
  );
}

/**
 * The band a card is dealt from. Due cards first — overdue reviews, then
 * learning steps whose time has come — then new cards, then everything that
 * is merely available: reviews not yet due, and learning cards whose next
 * step is still minutes away.
 *
 * That last band is the point. A learning card is "owed" only once its step
 * has come round; ranked ahead of new cards regardless, the ten cards a
 * learner answered a minute ago were the first ten of the next sitting, and a
 * deck opened twice in a row dealt the same hand twice. The offline selector
 * on the device already treats a not-yet-due learning card as filler, and the
 * progress aggregate already counts it as not due; this is the same rule.
 */
function band(reason: SelectionReason, due: boolean): number {
  switch (reason) {
    case SelectionReason.OVERDUE:
      return 0;
    case SelectionReason.LEARNING:
      return due ? 1 : 4;
    case SelectionReason.ERROR:
      return 2;
    case SelectionReason.NEW:
      return 3;
    case SelectionReason.MAINTENANCE:
      return 4;
  }
}

/** The bands whose cards are owed, and are therefore dealt in due order. */
const DUE_BANDS = new Set([0, 1]);

export function selectSessionCandidates<T extends SessionCandidate>(
  candidates: T[],
  requestedCount: number,
  sessionId: string,
  now: Date,
): Array<SelectedCandidate<T>> {
  return candidates
    .map((candidate) => {
      const reason = selectionReasonFor(candidate, now);
      return {
        candidate,
        reason,
        band: band(reason, isDue(candidate, now)),
        randomRank: deterministicRank(sessionId, candidate.learningCardId),
      };
    })
    .sort((left, right) => {
      const bandDifference = left.band - right.band;
      if (bandDifference !== 0) {
        return bandDifference;
      }
      if (DUE_BANDS.has(left.band)) {
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
