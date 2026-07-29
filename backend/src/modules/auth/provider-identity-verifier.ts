import { createHash } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  JSONWebKeySet,
  JWTVerifyGetKey,
  JWTPayload,
} from "jose" with { "resolution-mode": "import" };

import { ApiException } from "../../common/http/api.exception";
import type { EnvironmentVariables } from "../../config/environment.validation";

export interface VerifiedProviderIdentity {
  provider: "APPLE" | "GOOGLE";
  subject: string;
  email: string | null;
  emailVerified: boolean | null;
  isPrivateEmail: boolean | null;
}

const APPLE_ISSUER = "https://appleid.apple.com";
const GOOGLE_ISSUERS = [
  "https://accounts.google.com",
  "accounts.google.com",
] as const;
const LOCAL_KEY_ID = "country-flags-local-provider-v1";

export function localProviderJwks(secret: string): JSONWebKeySet {
  return {
    keys: [
      {
        kty: "oct",
        kid: LOCAL_KEY_ID,
        alg: "HS256",
        use: "sig",
        k: Buffer.from(secret).toString("base64url"),
      },
    ],
  };
}

function optionalBoolean(value: unknown): boolean | null {
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  return null;
}

function invalidProviderToken(
  provider: "APPLE" | "GOOGLE",
  reason: string,
): never {
  throw new ApiException(
    HttpStatus.UNAUTHORIZED,
    "PROVIDER_TOKEN_INVALID",
    `${provider === "APPLE" ? "Apple" : "Google"} identity token is invalid`,
    { provider, reason },
  );
}

@Injectable()
export class ProviderIdentityVerifier {
  private appleRemoteJwks?: JWTVerifyGetKey;
  private googleRemoteJwks?: JWTVerifyGetKey;
  private localKey?: CryptoKey | Uint8Array;

  constructor(private readonly config: ConfigService<EnvironmentVariables>) {}

  async verifyApple(
    identityToken: string,
    rawNonce: string,
  ): Promise<VerifiedProviderIdentity> {
    const expectedNonce = createHash("sha256").update(rawNonce).digest("hex");
    const payload = await this.verify(
      "APPLE",
      identityToken,
      APPLE_ISSUER,
      this.config.getOrThrow<string[]>("APPLE_CLIENT_IDS"),
    );
    if (payload.nonce !== expectedNonce) {
      invalidProviderToken("APPLE", "NONCE_MISMATCH");
    }

    return this.toIdentity("APPLE", payload);
  }

  async verifyGoogle(idToken: string): Promise<VerifiedProviderIdentity> {
    const payload = await this.verify(
      "GOOGLE",
      idToken,
      [...GOOGLE_ISSUERS],
      this.config.getOrThrow<string[]>("GOOGLE_CLIENT_IDS"),
    );
    return this.toIdentity("GOOGLE", payload);
  }

  private async verify(
    provider: "APPLE" | "GOOGLE",
    token: string,
    issuer: string | string[],
    audience: string[],
  ): Promise<JWTPayload> {
    try {
      const { jwtVerify } = await import("jose");
      const useTestKeys = this.config.getOrThrow<boolean>(
        "AUTH_PROVIDER_TEST_TOKENS_ENABLED",
      );
      const options = {
        algorithms: useTestKeys ? ["HS256"] : ["RS256"],
        issuer,
        audience,
        requiredClaims: ["sub", "iat", "exp"],
        clockTolerance: 5,
      };
      const result = useTestKeys
        ? await jwtVerify(token, await this.getLocalKey(), options)
        : await jwtVerify(token, await this.getRemoteJwks(provider), options);
      if (
        typeof result.payload.sub !== "string" ||
        result.payload.sub.length === 0 ||
        result.payload.sub.length > 255
      ) {
        invalidProviderToken(provider, "SUBJECT_INVALID");
      }
      return result.payload;
    } catch (error) {
      if (error instanceof ApiException) {
        throw error;
      }
      invalidProviderToken(provider, "CLAIMS_OR_SIGNATURE_INVALID");
    }
  }

  private toIdentity(
    provider: "APPLE" | "GOOGLE",
    payload: JWTPayload,
  ): VerifiedProviderIdentity {
    const email =
      typeof payload.email === "string" && payload.email.length <= 320
        ? payload.email
        : null;
    return {
      provider,
      subject: payload.sub!,
      email,
      emailVerified: optionalBoolean(payload.email_verified),
      isPrivateEmail:
        provider === "APPLE" ? optionalBoolean(payload.is_private_email) : null,
    };
  }

  private async getLocalKey(): Promise<CryptoKey | Uint8Array> {
    if (this.localKey === undefined) {
      const { importJWK } = await import("jose");
      const jwk = localProviderJwks(
        this.config.getOrThrow<string>("AUTH_PROVIDER_TEST_SECRET"),
      ).keys[0];
      if (jwk === undefined) {
        throw new Error("Local provider JWK is unavailable");
      }
      this.localKey = await importJWK(jwk, "HS256");
    }
    return this.localKey;
  }

  private async getRemoteJwks(
    provider: "APPLE" | "GOOGLE",
  ): Promise<JWTVerifyGetKey> {
    const { createRemoteJWKSet } = await import("jose");
    if (provider === "APPLE") {
      this.appleRemoteJwks ??= createRemoteJWKSet(
        new URL("https://appleid.apple.com/auth/keys"),
        { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 },
      );
      return this.appleRemoteJwks;
    }

    this.googleRemoteJwks ??= createRemoteJWKSet(
      new URL("https://www.googleapis.com/oauth2/v3/certs"),
      { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 },
    );
    return this.googleRemoteJwks;
  }
}
