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

  describe("a client clock the server never calibrated", () => {
    const receivedAt = new Date("2026-09-28T10:00:00.000Z");
    const notBefore = new Date("2026-09-01T00:00:00.000Z");

    it("keeps the time the guest actually studied", () => {
      const studied = new Date("2026-09-14T08:30:00.000Z");
      expect(
        normalizeReviewTime({
          clientOccurredAt: studied,
          estimatedServerOccurredAt: null,
          receivedAt,
          predecessor: null,
          successor: null,
          uncalibratedClientClock: { notBefore },
        }),
      ).toEqual({
        effectiveOccurredAt: studied,
        timeConfidence: TimeConfidence.CLIENT_CLOCK,
      });
    });

    it("does not let a clock set back place a review before its content existed", () => {
      expect(
        normalizeReviewTime({
          clientOccurredAt: new Date("2020-01-01T00:00:00.000Z"),
          estimatedServerOccurredAt: null,
          receivedAt,
          predecessor: null,
          successor: null,
          uncalibratedClientClock: { notBefore },
        }),
      ).toEqual({
        effectiveOccurredAt: notBefore,
        timeConfidence: TimeConfidence.BOUNDED,
      });
    });

    it("does not let a clock set forward place a review in the future", () => {
      expect(
        normalizeReviewTime({
          clientOccurredAt: new Date("2026-10-28T10:00:00.000Z"),
          estimatedServerOccurredAt: null,
          receivedAt,
          predecessor: null,
          successor: null,
          uncalibratedClientClock: { notBefore },
        }),
      ).toEqual({
        effectiveOccurredAt: receivedAt,
        timeConfidence: TimeConfidence.BOUNDED,
      });
    });

    it("still keeps the device's own order", () => {
      expect(
        normalizeReviewTime({
          clientOccurredAt: new Date("2026-09-14T08:30:00.000Z"),
          estimatedServerOccurredAt: null,
          receivedAt,
          predecessor: {
            effectiveOccurredAt: new Date("2026-09-15T00:00:00.000Z"),
          },
          successor: null,
          uncalibratedClientClock: { notBefore },
        }),
      ).toEqual({
        effectiveOccurredAt: new Date("2026-09-15T00:00:00.001Z"),
        timeConfidence: TimeConfidence.BOUNDED,
      });
    });

    it("prefers a calibrated estimate when the client has one", () => {
      const estimate = new Date("2026-09-14T08:30:02.000Z");
      expect(
        normalizeReviewTime({
          clientOccurredAt: new Date("2026-09-14T08:30:00.000Z"),
          estimatedServerOccurredAt: estimate,
          receivedAt,
          predecessor: null,
          successor: null,
          uncalibratedClientClock: { notBefore },
        }),
      ).toEqual({
        effectiveOccurredAt: estimate,
        timeConfidence: TimeConfidence.CALIBRATED,
      });
    });

    it("falls back to the time received without the option, as before", () => {
      expect(
        normalizeReviewTime({
          clientOccurredAt: new Date("2026-09-14T08:30:00.000Z"),
          estimatedServerOccurredAt: null,
          receivedAt,
          predecessor: null,
          successor: null,
        }),
      ).toEqual({
        effectiveOccurredAt: receivedAt,
        timeConfidence: TimeConfidence.RECEIVED_AT_FALLBACK,
      });
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
