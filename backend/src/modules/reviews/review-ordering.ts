import { TimeConfidence } from "@prisma/client";

export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const MAX_CLIENT_ESTIMATE_OFFSET_MS = 30 * 24 * 60 * 60 * 1000;
const CAUSAL_STEP_MS = 1;

export interface DeviceSequenceNeighbor {
  effectiveOccurredAt: Date;
}

export interface NormalizedReviewTime {
  effectiveOccurredAt: Date;
  timeConfidence: TimeConfidence;
}

export function normalizeReviewTime(input: {
  clientOccurredAt: Date;
  estimatedServerOccurredAt: Date | null;
  receivedAt: Date;
  predecessor: DeviceSequenceNeighbor | null;
  successor: DeviceSequenceNeighbor | null;
}): NormalizedReviewTime {
  const {
    clientOccurredAt,
    estimatedServerOccurredAt,
    receivedAt,
    predecessor,
    successor,
  } = input;
  let confidence: TimeConfidence;
  let effective: Date;

  if (
    estimatedServerOccurredAt === null ||
    Math.abs(estimatedServerOccurredAt.getTime() - clientOccurredAt.getTime()) >
      MAX_CLIENT_ESTIMATE_OFFSET_MS
  ) {
    effective = receivedAt;
    confidence = TimeConfidence.RECEIVED_AT_FALLBACK;
  } else {
    effective = estimatedServerOccurredAt;
    confidence = TimeConfidence.CALIBRATED;
  }

  if (effective.getTime() > receivedAt.getTime() + MAX_FUTURE_SKEW_MS) {
    effective = receivedAt;
    confidence = TimeConfidence.BOUNDED;
  }

  const lowerBound =
    predecessor === null
      ? Number.NEGATIVE_INFINITY
      : predecessor.effectiveOccurredAt.getTime() + CAUSAL_STEP_MS;
  const upperBound =
    successor === null
      ? Number.POSITIVE_INFINITY
      : successor.effectiveOccurredAt.getTime() - CAUSAL_STEP_MS;
  const bounded = Math.min(
    Math.max(effective.getTime(), lowerBound),
    upperBound,
  );
  if (bounded !== effective.getTime()) {
    effective = new Date(
      lowerBound <= upperBound
        ? bounded
        : (successor?.effectiveOccurredAt.getTime() ?? lowerBound),
    );
    confidence = TimeConfidence.BOUNDED;
  }

  return { effectiveOccurredAt: effective, timeConfidence: confidence };
}

export interface OrderedReviewEvent {
  id: string;
  deviceId: string | null;
  clientSequence: bigint;
  effectiveOccurredAt: Date;
  receivedAt: Date;
}

function baseCompare(
  left: OrderedReviewEvent,
  right: OrderedReviewEvent,
): number {
  const effective =
    left.effectiveOccurredAt.getTime() - right.effectiveOccurredAt.getTime();
  if (effective !== 0) {
    return effective;
  }
  const received = left.receivedAt.getTime() - right.receivedAt.getTime();
  if (received !== 0) {
    return received;
  }
  return left.id.localeCompare(right.id);
}

/**
 * Produces the canonical replay order. The priority queue follows normalized
 * effective time while per-device edges always preserve clientSequence, even
 * when an older offline event arrives after its successor.
 */
export function orderReviewEvents<T extends OrderedReviewEvent>(
  events: readonly T[],
): T[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const indegree = new Map(events.map((event) => [event.id, 0]));
  const successors = new Map<string, string[]>();
  const byDevice = new Map<string, T[]>();

  for (const event of events) {
    if (event.deviceId === null) {
      continue;
    }
    const deviceEvents = byDevice.get(event.deviceId) ?? [];
    deviceEvents.push(event);
    byDevice.set(event.deviceId, deviceEvents);
  }
  for (const deviceEvents of byDevice.values()) {
    deviceEvents.sort((left, right) => {
      if (left.clientSequence < right.clientSequence) {
        return -1;
      }
      if (left.clientSequence > right.clientSequence) {
        return 1;
      }
      return left.id.localeCompare(right.id);
    });
    for (let index = 1; index < deviceEvents.length; index += 1) {
      const predecessor = deviceEvents[index - 1];
      const successor = deviceEvents[index];
      if (predecessor === undefined || successor === undefined) {
        continue;
      }
      successors.set(predecessor.id, [
        ...(successors.get(predecessor.id) ?? []),
        successor.id,
      ]);
      indegree.set(successor.id, (indegree.get(successor.id) ?? 0) + 1);
    }
  }

  const ready = events
    .filter((event) => indegree.get(event.id) === 0)
    .sort(baseCompare);
  const ordered: T[] = [];
  while (ready.length > 0) {
    const next = ready.shift();
    if (next === undefined) {
      break;
    }
    ordered.push(next);
    for (const successorId of successors.get(next.id) ?? []) {
      const remaining = (indegree.get(successorId) ?? 0) - 1;
      indegree.set(successorId, remaining);
      if (remaining === 0) {
        const successor = byId.get(successorId);
        if (successor !== undefined) {
          ready.push(successor);
          ready.sort(baseCompare);
        }
      }
    }
  }
  if (ordered.length !== events.length) {
    throw new Error("Review event ordering graph contains a cycle");
  }
  return ordered;
}
