import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { EnvironmentVariables } from "../../../config/environment.validation";
import { localProviderJwks } from "../provider-identity-verifier";

interface TestProviderTokenOptions {
  subject?: string;
  audience?: string;
  email?: string;
  issuedAt?: Date;
  expiresAt?: Date;
  rawNonce?: string;
  isPrivateEmail?: boolean;
}

@Injectable()
export class TestProviderTokenSigner {
  constructor(private readonly config: ConfigService<EnvironmentVariables>) {}

  async signGoogle(options: TestProviderTokenOptions = {}): Promise<string> {
    return this.sign("GOOGLE", options);
  }

  async signApple(options: TestProviderTokenOptions = {}): Promise<string> {
    return this.sign("APPLE", options);
  }

  private async sign(
    provider: "APPLE" | "GOOGLE",
    options: TestProviderTokenOptions,
  ): Promise<string> {
    if (!this.config.getOrThrow<boolean>("AUTH_PROVIDER_TEST_TOKENS_ENABLED")) {
      throw new Error("Test provider token signing is disabled");
    }
    const { importJWK, SignJWT } = await import("jose");
    const jwk = localProviderJwks(
      this.config.getOrThrow<string>("AUTH_PROVIDER_TEST_SECRET"),
    ).keys[0];
    if (jwk === undefined) {
      throw new Error("Local provider JWK is unavailable");
    }
    const key = await importJWK(jwk, "HS256");
    const issuedAt = options.issuedAt ?? new Date();
    const expiresAt =
      options.expiresAt ?? new Date(issuedAt.getTime() + 5 * 60_000);
    const audience =
      options.audience ??
      this.config.getOrThrow<string[]>(
        provider === "APPLE" ? "APPLE_CLIENT_IDS" : "GOOGLE_CLIENT_IDS",
      )[0];
    if (audience === undefined) {
      throw new Error(`No ${provider} audience is configured`);
    }
    const rawNonce = options.rawNonce ?? "TEST_ONLY_country_flags_nonce_000001";
    const claims: Record<string, unknown> = {
      email:
        options.email ??
        (provider === "APPLE"
          ? "local-user@privaterelay.appleid.com"
          : "local-user@example.test"),
      email_verified: true,
      ...(provider === "APPLE"
        ? {
            nonce: createHash("sha256").update(rawNonce).digest("hex"),
            is_private_email: options.isPrivateEmail ?? true,
          }
        : {}),
    };

    return new SignJWT(claims)
      .setProtectedHeader({
        alg: "HS256",
        typ: "JWT",
        kid: "country-flags-local-provider-v1",
      })
      .setSubject(
        options.subject ?? `TEST_ONLY_${provider.toLowerCase()}_subject_000001`,
      )
      .setIssuer(
        provider === "APPLE"
          ? "https://appleid.apple.com"
          : "https://accounts.google.com",
      )
      .setAudience(audience)
      .setIssuedAt(Math.floor(issuedAt.getTime() / 1_000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
      .sign(key);
  }
}
