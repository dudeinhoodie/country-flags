import { ApiException } from "../../common/http/api.exception";
import {
  parseAppleTransactionSubmission,
  parseCommercePlatform,
  parseIdempotencyKey,
} from "./commerce.request";

function fieldOf(run: () => unknown): { status: number; field: string } {
  try {
    run();
  } catch (error) {
    if (!(error instanceof ApiException)) {
      throw error;
    }
    const body = error.getResponse() as {
      error: { details: { fields: Array<{ field: string }> } };
    };
    return {
      status: error.getStatus(),
      field: body.error.details.fields[0]?.field ?? "",
    };
  }
  throw new Error("Expected the request to be refused");
}

describe("parseCommercePlatform", () => {
  it("asks about iOS when nothing is asked", () => {
    expect(parseCommercePlatform(undefined)).toBe("IOS");
  });

  it("accepts the platforms the contract names", () => {
    expect(parseCommercePlatform("ANDROID")).toBe("ANDROID");
    expect(parseCommercePlatform("WEB")).toBe("WEB");
  });

  it("refuses a platform nothing is sold on", () => {
    expect(fieldOf(() => parseCommercePlatform("ios"))).toEqual({
      status: 422,
      field: "platform",
    });
  });
});

describe("parseIdempotencyKey", () => {
  it("requires the header the contract requires", () => {
    expect(fieldOf(() => parseIdempotencyKey(undefined)).field).toBe(
      "Idempotency-Key",
    );
    expect(fieldOf(() => parseIdempotencyKey("short")).field).toBe(
      "Idempotency-Key",
    );
  });

  it("accepts a key a client could plausibly have generated", () => {
    expect(parseIdempotencyKey("6f9619ff-8b86-d011-b42d-00cf4fc964ff")).toBe(
      "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
    );
  });
});

describe("parseAppleTransactionSubmission", () => {
  const transaction = { signedTransaction: "eyJhbGciOiJFUzI1NiJ9.e30.c2ln" };

  it("reads the signed payloads and nothing else", () => {
    expect(
      parseAppleTransactionSubmission({ transactions: [transaction] }),
    ).toEqual([transaction.signedTransaction]);
  });

  it("refuses anything the client thinks the purchase is worth", () => {
    // The whole rule of this endpoint: no deck, no offer, no entitlement
    // key, no price. The server reads the product out of the signed payload.
    expect(
      fieldOf(() =>
        parseAppleTransactionSubmission({
          transactions: [
            { ...transaction, deckId: "70000000-0000-4000-8000-000000000002" },
          ],
        }),
      ).field,
    ).toBe("transactions[0].deckId");
    expect(
      fieldOf(() =>
        parseAppleTransactionSubmission({
          transactions: [transaction],
          offerCode: "EUROPEAN_COATS_LIFETIME",
        }),
      ).field,
    ).toBe("body.offerCode");
  });

  it("holds the batch to the size the contract documents", () => {
    expect(
      fieldOf(() => parseAppleTransactionSubmission({ transactions: [] }))
        .field,
    ).toBe("transactions");
    expect(
      fieldOf(() =>
        parseAppleTransactionSubmission({
          transactions: new Array(101).fill(transaction),
        }),
      ).field,
    ).toBe("transactions");
    expect(
      parseAppleTransactionSubmission({
        transactions: new Array(100).fill(transaction),
      }),
    ).toHaveLength(100);
  });

  it("refuses a payload that is not a string, and one too long to be a JWS", () => {
    expect(
      fieldOf(() =>
        parseAppleTransactionSubmission({
          transactions: [{ signedTransaction: 42 }],
        }),
      ).field,
    ).toBe("transactions[0].signedTransaction");
    expect(
      fieldOf(() =>
        parseAppleTransactionSubmission({
          transactions: [{ signedTransaction: "a".repeat(8_193) }],
        }),
      ).field,
    ).toBe("transactions[0].signedTransaction");
  });

  it("refuses a body that is not a submission at all", () => {
    expect(fieldOf(() => parseAppleTransactionSubmission(null)).field).toBe(
      "body",
    );
    expect(
      fieldOf(() => parseAppleTransactionSubmission({ transactions: "one" }))
        .field,
    ).toBe("transactions");
  });
});
