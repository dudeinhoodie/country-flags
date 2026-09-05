import { redact } from "./redaction";

describe("redact", () => {
  it("redacts denylisted key names regardless of value shape", () => {
    const result = redact({
      accessToken: "opaque-value",
      password: "hunter2",
      authorization: "Bearer abc",
      pushToken: "device-token",
      nested: { providerSubject: "12345" },
    });

    expect(result).toEqual({
      accessToken: "[REDACTED]",
      password: "[REDACTED]",
      authorization: "[REDACTED]",
      pushToken: "[REDACTED]",
      nested: { providerSubject: "[REDACTED]" },
    });
  });

  it("redacts JWT-shaped and Bearer-prefixed string values under any key name", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature-part-value";
    const result = redact({
      note: jwt,
      header: "Bearer some-opaque-token-value",
    });

    expect(result).toEqual({
      note: "[REDACTED]",
      header: "[REDACTED]",
    });
  });

  it("redacts an email address embedded in free text", () => {
    const result = redact({
      message: "Failed to notify user test.user+tag@example.com about X",
    });

    expect(result.message).toBe("Failed to notify user [REDACTED] about X");
  });

  it("recurses into arrays and nested objects", () => {
    const result = redact({
      items: [{ email: "a@example.com" }, { safe: "value" }],
    });

    expect(result).toEqual({
      items: [{ email: "[REDACTED]" }, { safe: "value" }],
    });
  });

  it("does not treat a short dotted identifier like a semver as a JWT", () => {
    const result = redact({
      appVersion: "1.0.0",
      hostname: "api.country-flags.app",
    });

    expect(result).toEqual({
      appVersion: "1.0.0",
      hostname: "api.country-flags.app",
    });
  });

  it("keeps the evidence of a purchase out of every log line", () => {
    // A JWS, the transaction it names and the account token it carries are
    // the three things §16 forbids a paid-decks log line from holding, and
    // the private key is forbidden everywhere.
    const result = redact({
      signedTransaction: "eyJhbGciOiJFUzI1NiJ9.eyJ0eCI6MX0.c2ln",
      signedPayload: "eyJhbGciOiJFUzI1NiJ9.eyJ0eCI6MX0.c2ln",
      jws: "eyJhbGciOiJFUzI1NiJ9.eyJ0eCI6MX0.c2ln",
      transactionId: "2000000900000001",
      transaction_id: "2000000900000001",
      originalTransactionId: "2000000800000001",
      appAccountToken: "a0000000-0000-4000-8000-000000000001",
      storeAccountToken: "a0000000-0000-4000-8000-000000000001",
      // Denied by its name, not by looking like a key: a PEM header is not
      // what a leak looks like by the time it reaches a log field.
      privateKey: "TEST_ONLY_not_a_key",
      COMMERCE_APPLE_IAP_PRIVATE_KEY: "TEST_ONLY_base64_pkcs8_placeholder",
    });

    expect(Object.values(result)).toEqual(
      new Array(Object.keys(result).length).fill("[REDACTED]"),
    );
  });

  it("keeps the masked reference support actually works from", () => {
    // Enough to find the row and useless as evidence, which is the whole
    // point of it existing (§15.3).
    const result = redact({
      transactionReference: "****0001",
      productId: "app.countryflags.deck.european_coats.lifetime.v1",
      reason: "UNKNOWN_PRODUCT",
    });

    expect(result).toEqual({
      transactionReference: "****0001",
      productId: "app.countryflags.deck.european_coats.lifetime.v1",
      reason: "UNKNOWN_PRODUCT",
    });
  });

  it("leaves safe fields untouched", () => {
    const result = redact({
      requestId: "11111111-1111-4111-8111-111111111111",
      statusCode: 200,
      durationMs: 42,
    });

    expect(result).toEqual({
      requestId: "11111111-1111-4111-8111-111111111111",
      statusCode: 200,
      durationMs: 42,
    });
  });
});
