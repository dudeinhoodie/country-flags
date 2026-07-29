import { TimeConfidence } from "@prisma/client";

import { normalizeReviewTime, orderReviewEvents } from "./review-ordering";

describe("review ordering", () => {
  it("clamps impossible future time and preserves device sequence bounds", () => {
    const receivedAt = new Date("2026-07-29T10:00:00.000Z");
    const normalized = normalizeReviewTime({
      clientOccurredAt: new Date("2026-07-29T10:00:00.000Z"),
      estimatedServerOccurredAt: new Date("2026-07-30T10:00:00.000Z"),
      receivedAt,
      predecessor: {
        effectiveOccurredAt: new Date("2026-07-29T09:59:59.999Z"),
      },
      successor: null,
    });

    expect(normalized).toEqual({
      effectiveOccurredAt: receivedAt,
      timeConfidence: TimeConfidence.BOUNDED,
    });
  });

  it("falls back when the client/server estimate offset is corrupt", () => {
    const receivedAt = new Date("2026-07-29T10:00:00.000Z");
    expect(
      normalizeReviewTime({
        clientOccurredAt: new Date("2020-01-01T00:00:00.000Z"),
        estimatedServerOccurredAt: new Date("2026-07-01T00:00:00.000Z"),
        receivedAt,
        predecessor: null,
        successor: null,
      }),
    ).toEqual({
      effectiveOccurredAt: receivedAt,
      timeConfidence: TimeConfidence.RECEIVED_AT_FALLBACK,
    });
  });

  it("uses effective time across devices but never reverses clientSequence", () => {
    const event = (
      id: string,
      deviceId: string,
      clientSequence: bigint,
      effective: string,
    ): {
      id: string;
      deviceId: string;
      clientSequence: bigint;
      effectiveOccurredAt: Date;
      receivedAt: Date;
    } => ({
      id,
      deviceId,
      clientSequence,
      effectiveOccurredAt: new Date(effective),
      receivedAt: new Date("2026-07-29T12:00:00.000Z"),
    });
    const sequenceTwo = event(
      "00000000-0000-4000-8000-000000000002",
      "device-a",
      2n,
      "2026-07-29T09:00:00.000Z",
    );
    const otherDevice = event(
      "00000000-0000-4000-8000-000000000003",
      "device-b",
      1n,
      "2026-07-29T10:00:00.000Z",
    );
    const sequenceOne = event(
      "00000000-0000-4000-8000-000000000001",
      "device-a",
      1n,
      "2026-07-29T11:00:00.000Z",
    );

    expect(
      orderReviewEvents([sequenceTwo, otherDevice, sequenceOne]).map(
        ({ id }) => id,
      ),
    ).toEqual([otherDevice.id, sequenceOne.id, sequenceTwo.id]);
  });
});
