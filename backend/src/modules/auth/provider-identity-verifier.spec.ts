import { ConfigService } from "@nestjs/config";

import {
  type EnvironmentVariables,
  validateEnvironment,
} from "../../config/environment.validation";
import { ProviderIdentityVerifier } from "./provider-identity-verifier";
import { TestProviderTokenSigner } from "./testing/test-provider-token-signer";

describe("ProviderIdentityVerifier", () => {
  const environment = validateEnvironment({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  });
  const config = new ConfigService<EnvironmentVariables>(environment);
  const verifier = new ProviderIdentityVerifier(config);
  const signer = new TestProviderTokenSigner(config);

  it("verifies required Google claims and signature", async () => {
    const token = await signer.signGoogle({
      subject: "google-user-1",
      email: "same@example.test",
    });

    await expect(verifier.verifyGoogle(token)).resolves.toMatchObject({
      provider: "GOOGLE",
      subject: "google-user-1",
      email: "same@example.test",
      emailVerified: true,
      isPrivateEmail: null,
    });
  });

  it("verifies the hashed Apple nonce and relay metadata", async () => {
    const rawNonce = "a-secure-raw-nonce-value";
    const token = await signer.signApple({
      subject: "apple-user-1",
      rawNonce,
      email: "relay@privaterelay.appleid.com",
      isPrivateEmail: true,
    });

    await expect(verifier.verifyApple(token, rawNonce)).resolves.toMatchObject({
      provider: "APPLE",
      subject: "apple-user-1",
      email: "relay@privaterelay.appleid.com",
      emailVerified: true,
      isPrivateEmail: true,
    });
  });

  it("returns predictable errors for audience, expiry, nonce, and signature", async () => {
    const wrongAudience = await signer.signGoogle({
      audience: "another-client",
    });
    const expired = await signer.signGoogle({
      issuedAt: new Date("2020-01-01T00:00:00.000Z"),
      expiresAt: new Date("2020-01-01T00:05:00.000Z"),
    });
    const apple = await signer.signApple({
      rawNonce: "the-original-raw-nonce",
    });
    const valid = await signer.signGoogle();
    const [header, payload, signature] = valid.split(".");
    if (
      header === undefined ||
      payload === undefined ||
      signature === undefined
    ) {
      throw new Error("Test provider token is malformed");
    }
    const modified = `${header}.${payload}.${
      signature.startsWith("a") ? "b" : "a"
    }${signature.slice(1)}`;

    for (const token of [wrongAudience, expired, modified]) {
      await expect(verifier.verifyGoogle(token)).rejects.toMatchObject({
        response: {
          error: {
            code: "PROVIDER_TOKEN_INVALID",
            details: { provider: "GOOGLE" },
          },
        },
      });
    }
    await expect(
      verifier.verifyApple(apple, "a-different-raw-nonce"),
    ).rejects.toMatchObject({
      response: {
        error: {
          code: "PROVIDER_TOKEN_INVALID",
          details: { provider: "APPLE", reason: "NONCE_MISMATCH" },
        },
      },
    });
  });
});
