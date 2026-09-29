import { randomBytes } from "node:crypto";

import { ConfigService } from "@nestjs/config";

import type { EnvironmentVariables } from "../../config/environment.validation";
import { ProviderTokenCipher } from "./provider-token-cipher";

function cipherWith(key: string): ProviderTokenCipher {
  return new ProviderTokenCipher(
    new ConfigService<EnvironmentVariables>({
      AUTH_PROVIDER_TOKEN_ENCRYPTION_KEY: key,
    }),
  );
}

describe("ProviderTokenCipher", () => {
  const key = randomBytes(32).toString("base64");
  const cipher = cipherWith(key);
  const token = "r0f8c1d2e3.0.nrxy.TEST_ONLY_apple_refresh_token";
  const context = "auth_identities:APPLE:000123.abc";

  it("opens what it sealed, and the sealed form holds no plaintext", () => {
    const sealed = cipher.seal(token, context);

    expect(sealed).toMatch(
      /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
    expect(sealed).not.toContain(token);
    expect(cipher.open(sealed, context)).toBe(token);
  });

  it("seals the same token differently every time", () => {
    expect(cipher.seal(token, context)).not.toBe(cipher.seal(token, context));
  });

  it("refuses a ciphertext moved to another identity", () => {
    const sealed = cipher.seal(token, context);

    expect(() => cipher.open(sealed, "auth_identities:APPLE:other")).toThrow();
  });

  it("refuses a tampered ciphertext and another key", () => {
    const sealed = cipher.seal(token, context);
    const [version, iv, body, tag] = sealed.split(".");
    const flipped = Buffer.from(body ?? "", "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;

    expect(() =>
      cipher.open(
        [version, iv, flipped.toString("base64url"), tag].join("."),
        context,
      ),
    ).toThrow();
    expect(() =>
      cipherWith(randomBytes(32).toString("base64")).open(sealed, context),
    ).toThrow();
    expect(() => cipher.open("v2.a.b.c", context)).toThrow("unknown format");
  });

  it("is unconfigured without a key and refuses to seal", () => {
    const unconfigured = cipherWith("");

    expect(unconfigured.configured).toBe(false);
    expect(() => unconfigured.seal(token, context)).toThrow(
      "Provider token encryption is not configured",
    );
    expect(cipher.configured).toBe(true);
  });
});
