import { HttpException } from "@nestjs/common";

import {
  parseCompleteStudySessionRequest,
  parseCreateStudySessionRequest,
  requestHash,
} from "./study-session.request";

const LEARNING_CARD_ID = "50000000-0000-4000-8000-000000000005";
const ASSET_SHA256 =
  "3f786850e387550fdab836ed7e6dc881de23001b8b9f4e0bd6c1b0aa5c0ba9b1";

function offlineCard(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    learningCardId: LEARNING_CARD_ID,
    learningCardRevision: 1,
    assetSha256: ASSET_SHA256,
    randomSeed: "offline-seed-0001",
    distractorPolicyVersion: null,
    snapshot: { id: LEARNING_CARD_ID, revision: 1 },
    ...overrides,
  };
}

function offlineBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "90000000-0000-4000-8000-000000000011",
    deckId: "70000000-0000-4000-8000-000000000001",
    requestedUniqueCount: 5,
    mode: "SELF_RATED",
    locale: "en",
    selectionOrigin: "CLIENT_OFFLINE",
    startedAt: "2026-07-29T09:40:00.000Z",
    contentVersion: "test-only-fixture-v1",
    cards: [offlineCard()],
    ...overrides,
  };
}

function twoCards(): Array<Record<string, unknown>> {
  const second = "50000000-0000-4000-8000-000000000006";
  return [
    offlineCard(),
    offlineCard({
      learningCardId: second,
      snapshot: { id: second, revision: 1 },
    }),
  ];
}

function withoutContentVersion(): Record<string, unknown> {
  const body: Record<string, unknown> = offlineBody();
  delete body.contentVersion;
  return body;
}

function errorCode(body: unknown): string {
  try {
    parseCreateStudySessionRequest(body);
  } catch (error) {
    if (!(error instanceof HttpException)) {
      throw error;
    }
    const response = error.getResponse() as { error?: { code?: string } };
    return response.error?.code ?? "UNTYPED";
  }
  throw new Error("Request was accepted but should have been rejected");
}

describe("parseCompleteStudySessionRequest", () => {
  it("accepts the canonical completion body", () => {
    expect(
      parseCompleteStudySessionRequest({
        completedAt: "2026-07-29T10:02:30.000Z",
      }),
    ).toEqual({ completedAt: new Date("2026-07-29T10:02:30.000Z") });
  });

  it.each([
    ["a non-object body", "completedAt"],
    ["a missing field", {}],
    ["an unknown field", { completedAt: "2026-07-29T10:02:30.000Z", n: 1 }],
    ["a non date-time value", { completedAt: "yesterday" }],
    ["a numeric value", { completedAt: 1_760_000_000 }],
  ])("rejects %s", (_case, body) => {
    expect(() => parseCompleteStudySessionRequest(body)).toThrow();
  });
});

describe("parseCreateStudySessionRequest", () => {
  it("parses the canonical server body", () => {
    expect(
      parseCreateStudySessionRequest({
        id: "90000000-0000-4000-8000-000000000001",
        deckId: "70000000-0000-4000-8000-000000000001",
        requestedUniqueCount: 5,
        mode: "SELF_RATED",
        locale: "en",
        selectionOrigin: "SERVER",
      }),
    ).toEqual({
      id: "90000000-0000-4000-8000-000000000001",
      deckId: "70000000-0000-4000-8000-000000000001",
      requestedUniqueCount: 5,
      mode: "SELF_RATED",
      locale: "en",
      selectionOrigin: "SERVER",
      composition: "STANDARD",
    });
  });

  it("parses the canonical offline import body", () => {
    expect(parseCreateStudySessionRequest(offlineBody())).toEqual({
      id: "90000000-0000-4000-8000-000000000011",
      deckId: "70000000-0000-4000-8000-000000000001",
      requestedUniqueCount: 5,
      mode: "SELF_RATED",
      locale: "en",
      selectionOrigin: "CLIENT_OFFLINE",
      startedAt: new Date("2026-07-29T09:40:00.000Z"),
      contentVersion: "test-only-fixture-v1",
      cards: [
        {
          learningCardId: LEARNING_CARD_ID,
          learningCardRevision: 1,
          assetSha256: ASSET_SHA256,
          randomSeed: "offline-seed-0001",
        },
      ],
    });
  });

  it("keeps the client selection order", () => {
    const second = "50000000-0000-4000-8000-000000000006";
    const parsed = parseCreateStudySessionRequest(
      offlineBody({
        cards: [
          offlineCard(),
          offlineCard({
            learningCardId: second,
            snapshot: { id: second, revision: 1 },
          }),
        ],
      }),
    );

    expect(
      "cards" in parsed
        ? parsed.cards.map(({ learningCardId }) => learningCardId)
        : [],
    ).toEqual([LEARNING_CARD_ID, second]);
  });

  it.each([
    ["an objective mode", offlineBody({ mode: "MULTIPLE_CHOICE" })],
    [
      "a card carrying options",
      offlineBody({
        cards: [
          offlineCard({
            options: [
              { id: "a0000000-0000-4000-8000-000000000001", position: 0 },
            ],
          }),
        ],
      }),
    ],
    [
      "a client distractor policy",
      offlineBody({
        cards: [offlineCard({ distractorPolicyVersion: "client-v1" })],
      }),
    ],
  ])("rejects %s with a typed offline mode error", (_case, body) => {
    expect(errorCode(body)).toBe("OFFLINE_MODE_UNSUPPORTED");
  });

  it.each([
    ["an unknown field", offlineBody({ extra: true })],
    ["a missing field", withoutContentVersion()],
    ["an empty composition", offlineBody({ cards: [] })],
    [
      "more cards than requested",
      offlineBody({
        requestedUniqueCount: 5,
        cards: Array.from({ length: 6 }, (_value, index) => {
          const id = `50000000-0000-4000-8000-00000000000${index}`;
          return offlineCard({
            learningCardId: id,
            snapshot: { id, revision: 1 },
          });
        }),
      }),
    ],
    ["a repeated card", offlineBody({ cards: [offlineCard(), offlineCard()] })],
    [
      "a snapshot for another card",
      offlineBody({
        cards: [
          offlineCard({
            snapshot: {
              id: "50000000-0000-4000-8000-000000000006",
              revision: 1,
            },
          }),
        ],
      }),
    ],
    [
      "a snapshot of another revision",
      offlineBody({
        cards: [
          offlineCard({ snapshot: { id: LEARNING_CARD_ID, revision: 2 } }),
        ],
      }),
    ],
    [
      "a non-hex asset checksum",
      offlineBody({ cards: [offlineCard({ assetSha256: "not-a-checksum" })] }),
    ],
    [
      "a zero revision",
      offlineBody({ cards: [offlineCard({ learningCardRevision: 0 })] }),
    ],
    ["a non date-time start", offlineBody({ startedAt: "yesterday" })],
    ["an empty content version", offlineBody({ contentVersion: "" })],
    ["an unsupported session size", offlineBody({ requestedUniqueCount: 7 })],
  ])("rejects %s with a typed validation error", (_case, body) => {
    expect(errorCode(body)).toBe("VALIDATION_FAILED");
  });
});

describe("requestHash", () => {
  it("keeps the committed server digest stable", () => {
    // Server session hashes are persisted, so a change here would turn every
    // stored session into an idempotency conflict.
    expect(
      requestHash(
        parseCreateStudySessionRequest({
          id: "90000000-0000-4000-8000-000000000001",
          deckId: "70000000-0000-4000-8000-000000000001",
          requestedUniqueCount: 5,
          mode: "SELF_RATED",
          locale: "en",
          selectionOrigin: "SERVER",
        }),
      ),
    ).toBe("044c50dd6bdf895a5a06633be3ebf51dd2a21b4f021f679ead039cd548294b84");
  });

  it("is stable for an identical offline composition", () => {
    expect(requestHash(parseCreateStudySessionRequest(offlineBody()))).toBe(
      requestHash(parseCreateStudySessionRequest(offlineBody())),
    );
  });

  it.each([
    [
      "a reordered composition",
      offlineBody({ cards: [...twoCards()].reverse() }),
    ],
    [
      "a different start instant",
      offlineBody({ cards: twoCards(), startedAt: "2026-07-29T09:41:00.000Z" }),
    ],
    [
      "a different content version",
      offlineBody({ cards: twoCards(), contentVersion: "other-fixture-v1" }),
    ],
    [
      "a different card seed",
      offlineBody({
        cards: twoCards().map((card) => ({
          ...card,
          randomSeed: "offline-seed-0002",
        })),
      }),
    ],
  ])("changes for %s", (_case, variant) => {
    const base = requestHash(
      parseCreateStudySessionRequest(offlineBody({ cards: twoCards() })),
    );

    expect(requestHash(parseCreateStudySessionRequest(variant))).not.toBe(base);
  });
});


describe("composition", () => {
  const server = {
    id: "6f9b91c2-9a44-4b6e-9a6b-3d4f8b6a2c11",
    deckId: "6f9b91c2-9a44-4b6e-9a6b-3d4f8b6a2c12",
    requestedUniqueCount: 10,
    mode: "SELF_RATED",
    locale: "en-US",
    selectionOrigin: "SERVER",
  };

  it("defaults to STANDARD when the field is absent", () => {
    const parsed = parseCreateStudySessionRequest(server);
    expect(parsed).toMatchObject({ composition: "STANDARD" });
  });

  it("accepts DUE_ONLY", () => {
    const parsed = parseCreateStudySessionRequest({
      ...server,
      composition: "DUE_ONLY",
    });
    expect(parsed).toMatchObject({ composition: "DUE_ONLY" });
  });

  it("rejects a composition the contract does not name", () => {
    expect(() =>
      parseCreateStudySessionRequest({ ...server, composition: "REVIEW" }),
    ).toThrow("composition must be STANDARD or DUE_ONLY");
  });

  it("keeps the idempotency hash sensitive to the composition", () => {
    const standard = parseCreateStudySessionRequest(server);
    const dueOnly = parseCreateStudySessionRequest({
      ...server,
      composition: "DUE_ONLY",
    });
    expect(requestHash(standard)).not.toEqual(requestHash(dueOnly));
  });
});
