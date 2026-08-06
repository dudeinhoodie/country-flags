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
