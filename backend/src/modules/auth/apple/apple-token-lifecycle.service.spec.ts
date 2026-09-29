import { randomBytes } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { ProviderTokenState } from "@prisma/client";

import type { JsonLoggerService } from "../../../common/logging/json-logger.service";
import type { EnvironmentVariables } from "../../../config/environment.validation";
import type { VerifiedProviderIdentity } from "../provider-identity-verifier";
import { ProviderTokenCipher } from "../provider-token-cipher";
import {
  AppleTokenClient,
  type AppleTokenExchange,
  type AppleTokenRevocation,
} from "./apple-token.client";
import { AppleTokenLifecycle } from "./apple-token-lifecycle.service";

class FakeAppleTokenClient extends AppleTokenClient {
  isConfigured = true;
  exchangeAnswer: AppleTokenExchange = {
    kind: "exchanged",
    refreshToken: "TEST_ONLY_apple_refresh",
  };
  revocationAnswer: AppleTokenRevocation = { kind: "revoked" };
  readonly revoked: Array<{ clientId: string; refreshToken: string }> = [];

  get configured(): boolean {
    return this.isConfigured;
  }

  exchangeAuthorizationCode(): Promise<AppleTokenExchange> {
    return Promise.resolve(this.exchangeAnswer);
  }

  revokeRefreshToken(input: {
    clientId: string;
    refreshToken: string;
  }): Promise<AppleTokenRevocation> {
    this.revoked.push(input);
    return Promise.resolve(this.revocationAnswer);
  }
}

describe("AppleTokenLifecycle", () => {
  const identity: VerifiedProviderIdentity = {
    provider: "APPLE",
    subject: "000123.apple-subject",
    email: null,
    emailVerified: null,
    isPrivateEmail: null,
    issuedAt: new Date(),
    audience: "app.countryflags.mobile",
  };
  let client: FakeAppleTokenClient;
  let logger: {
    log: jest.Mock<void, [unknown]>;
    warn: jest.Mock<void, [unknown]>;
    error: jest.Mock<void, [unknown]>;
  };
  let lifecycle: AppleTokenLifecycle;

  function build(encryptionKey: string): AppleTokenLifecycle {
    return new AppleTokenLifecycle(
      client,
      new ProviderTokenCipher(
        new ConfigService<EnvironmentVariables>({
          AUTH_PROVIDER_TOKEN_ENCRYPTION_KEY: encryptionKey,
        }),
      ),
      logger as unknown as JsonLoggerService,
    );
  }

  beforeEach(() => {
    client = new FakeAppleTokenClient();
    logger = {
      log: jest.fn<void, [unknown]>(),
      warn: jest.fn<void, [unknown]>(),
      error: jest.fn<void, [unknown]>(),
    };
    lifecycle = build(randomBytes(32).toString("base64"));
  });

  it("keeps the exchanged token sealed, with the client it was issued to", async () => {
    const grant = await lifecycle.exchange(identity, "code", "request-1");

    expect(grant.state).toBe(ProviderTokenState.STORED);
    expect(grant.clientId).toBe("app.countryflags.mobile");
    expect(grant.sealedRefreshToken).not.toContain("TEST_ONLY_apple_refresh");

    await expect(
      lifecycle.revoke(
        {
          providerSubject: identity.subject,
          providerTokenCiphertext: grant.sealedRefreshToken,
          providerTokenClientId: grant.clientId,
          providerTokenState: grant.state,
        },
        "request-2",
      ),
    ).resolves.toEqual({ outcome: "revoked", failure: null });
    expect(client.revoked).toEqual([
      {
        clientId: "app.countryflags.mobile",
        refreshToken: "TEST_ONLY_apple_refresh",
      },
    ]);
  });

  it("states and logs a missing key instead of pretending", async () => {
    client.isConfigured = false;

    await expect(
      lifecycle.exchange(identity, "code", "request-1"),
    ).resolves.toEqual({
      state: ProviderTokenState.CREDENTIALS_NOT_CONFIGURED,
      sealedRefreshToken: null,
      clientId: null,
    });
    await expect(
      lifecycle.revoke(
        {
          providerSubject: identity.subject,
          providerTokenCiphertext: null,
          providerTokenClientId: null,
          providerTokenState: ProviderTokenState.CREDENTIALS_NOT_CONFIGURED,
        },
        "request-2",
      ),
    ).resolves.toEqual({
      outcome: "credentials_not_configured",
      failure: null,
    });
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ outcome: "credentials_not_configured" }),
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ outcome: "credentials_not_configured" }),
    );
  });

  it("treats a missing encryption key as a missing key", async () => {
    lifecycle = build("");

    expect(lifecycle.configured).toBe(false);
    await expect(
      lifecycle.exchange(identity, "code", "request-1"),
    ).resolves.toMatchObject({
      state: ProviderTokenState.CREDENTIALS_NOT_CONFIGURED,
    });
  });

  it("lets a failed exchange through, recorded and logged", async () => {
    client.exchangeAnswer = { kind: "failed", reason: "invalid_grant" };

    await expect(
      lifecycle.exchange(identity, "code", "request-1"),
    ).resolves.toEqual({
      state: ProviderTokenState.EXCHANGE_FAILED,
      sealedRefreshToken: null,
      clientId: null,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "apple_code_exchange_failed",
        failure: "invalid_grant",
      }),
    );
  });

  it("reports every way a deletion can end without revoking", async () => {
    await expect(lifecycle.revoke(null, "request-1")).resolves.toEqual({
      outcome: "not_applicable_no_apple_identity",
      failure: null,
    });
    await expect(
      lifecycle.revoke(
        {
          providerSubject: identity.subject,
          providerTokenCiphertext: null,
          providerTokenClientId: null,
          providerTokenState: ProviderTokenState.EXCHANGE_FAILED,
        },
        "request-2",
      ),
    ).resolves.toEqual({ outcome: "no_token_stored", failure: null });

    const grant = await lifecycle.exchange(identity, "code", "request-3");
    const stored = {
      providerSubject: identity.subject,
      providerTokenCiphertext: grant.sealedRefreshToken,
      providerTokenClientId: grant.clientId,
      providerTokenState: grant.state,
    };
    client.revocationAnswer = { kind: "failed", reason: "unavailable" };
    await expect(lifecycle.revoke(stored, "request-4")).resolves.toEqual({
      outcome: "revocation_failed",
      failure: "unavailable",
    });
    await expect(
      lifecycle.revoke(
        { ...stored, providerSubject: "somebody-else" },
        "request-5",
      ),
    ).resolves.toEqual({
      outcome: "revocation_failed",
      failure: "undecryptable",
    });
    expect(logger.error).toHaveBeenCalledTimes(2);
    // Nothing a log line carries is token material.
    const logged = JSON.stringify([
      logger.warn.mock.calls as unknown[],
      logger.error.mock.calls as unknown[],
    ]);
    expect(logged).not.toContain("TEST_ONLY_apple_refresh");
    expect(logged).not.toContain(grant.sealedRefreshToken);
  });
});
