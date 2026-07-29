import { TestJwtSigner } from "./test-jwt-signer";

describe("TestJwtSigner", () => {
  const signer = new TestJwtSigner();
  const now = new Date("2026-07-29T10:00:00.000Z");
  const userId = "80000000-0000-4000-8000-000000000001";

  it("signs and verifies a scoped test token", () => {
    const token = signer.sign(userId, {
      issuedAt: now,
      expiresAt: new Date("2026-07-29T11:00:00.000Z"),
    });

    expect(signer.verify(token, now)).toMatchObject({
      sub: userId,
      iss: "country-flags-test",
      aud: "country-flags-api",
      testOnly: true,
    });
  });

  it("rejects an expired or modified token", () => {
    const token = signer.sign(userId, {
      issuedAt: now,
      expiresAt: new Date("2026-07-29T11:00:00.000Z"),
    });

    expect(() =>
      signer.verify(token, new Date("2026-07-29T11:00:00.000Z")),
    ).toThrow("Expired");
    expect(() => signer.verify(`${token.slice(0, -1)}x`, now)).toThrow(
      "signature",
    );
  });
});
