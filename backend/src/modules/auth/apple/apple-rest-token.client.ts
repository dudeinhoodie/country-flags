import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { EnvironmentVariables } from "../../../config/environment.validation";
import {
  AppleTokenClient,
  type AppleTokenExchange,
  type AppleTokenFailure,
  type AppleTokenRevocation,
} from "./apple-token.client";

const APPLE_AUDIENCE = "https://appleid.apple.com";
const TOKEN_URL = "https://appleid.apple.com/auth/token";
const REVOKE_URL = "https://appleid.apple.com/auth/revoke";
/** Apple allows up to six months; an hour keeps a leaked secret short-lived. */
const CLIENT_SECRET_TTL_SECONDS = 60 * 60;
/** A secret is replaced this long before it expires. */
const CLIENT_SECRET_REFRESH_MARGIN_SECONDS = 5 * 60;
const REQUEST_TIMEOUT_MS = 5_000;

const APPLE_ERRORS = new Set<AppleTokenFailure>([
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "unsupported_token_type",
]);

type Fetch = typeof fetch;

/** Lets a test hand the adapter its own `fetch`; production uses the global. */
export const APPLE_TOKEN_FETCH = Symbol("APPLE_TOKEN_FETCH");

/**
 * The Sign in with Apple REST adapter.
 *
 * Authenticates with a client secret: an ES256 JWT signed with the team's
 * Sign in with Apple key (`AUTH_APPLE_TEAM_ID`, `AUTH_APPLE_KEY_ID`,
 * `AUTH_APPLE_PRIVATE_KEY`), naming the app's bundle id as its subject. That
 * key is not the App Store Server API key the commerce module holds; Apple
 * issues them separately and they cannot stand in for each other.
 *
 * Neither the authorization code, the refresh token nor the client secret is
 * ever logged or put into an error.
 */
@Injectable()
export class AppleRestTokenClient extends AppleTokenClient {
  private readonly teamId: string;
  private readonly keyId: string;
  private readonly privateKey: string;
  private signingKey?: Promise<CryptoKey>;
  private readonly secrets = new Map<
    string,
    { value: string; expiresAt: number }
  >();

  private readonly fetchImpl: Fetch;

  constructor(
    config: ConfigService<EnvironmentVariables>,
    @Optional() @Inject(APPLE_TOKEN_FETCH) fetchImpl?: Fetch,
  ) {
    super();
    this.fetchImpl =
      fetchImpl ?? ((input, init): Promise<Response> => fetch(input, init));
    this.teamId = config.get<string>("AUTH_APPLE_TEAM_ID") ?? "";
    this.keyId = config.get<string>("AUTH_APPLE_KEY_ID") ?? "";
    this.privateKey = config.get<string>("AUTH_APPLE_PRIVATE_KEY") ?? "";
  }

  get configured(): boolean {
    return (
      this.teamId.length > 0 &&
      this.keyId.length > 0 &&
      this.privateKey.length > 0
    );
  }

  async exchangeAuthorizationCode(input: {
    clientId: string;
    authorizationCode: string;
  }): Promise<AppleTokenExchange> {
    if (!this.configured) {
      return { kind: "not_configured" };
    }
    const response = await this.post(TOKEN_URL, input.clientId, {
      grant_type: "authorization_code",
      code: input.authorizationCode,
    });
    if (response.kind === "failed") {
      return response;
    }
    const refreshToken = (response.body as { refresh_token?: unknown } | null)
      ?.refresh_token;
    if (typeof refreshToken !== "string" || refreshToken.length === 0) {
      return { kind: "failed", reason: "malformed_response" };
    }
    return { kind: "exchanged", refreshToken };
  }

  async revokeRefreshToken(input: {
    clientId: string;
    refreshToken: string;
  }): Promise<AppleTokenRevocation> {
    if (!this.configured) {
      return { kind: "not_configured" };
    }
    const response = await this.post(REVOKE_URL, input.clientId, {
      token: input.refreshToken,
      token_type_hint: "refresh_token",
    });
    return response.kind === "failed" ? response : { kind: "revoked" };
  }

  private async post(
    url: string,
    clientId: string,
    fields: Record<string, string>,
  ): Promise<
    | { kind: "ok"; body: unknown }
    | { kind: "failed"; reason: AppleTokenFailure }
  > {
    let clientSecret: string;
    try {
      clientSecret = await this.clientSecret(clientId);
    } catch {
      // A key that does not sign is a configuration Apple would refuse.
      return { kind: "failed", reason: "invalid_client" };
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { accept: "application/json" },
        body: new URLSearchParams({
          ...fields,
          client_id: clientId,
          client_secret: clientSecret,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { kind: "failed", reason: "unavailable" };
    }
    const text = await response.text().catch(() => "");
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = null;
      }
    }
    if (response.ok) {
      return { kind: "ok", body };
    }
    if (response.status >= 500 || response.status === 429) {
      return { kind: "failed", reason: "unavailable" };
    }
    const error = (body as { error?: unknown } | null)?.error;
    return {
      kind: "failed",
      reason:
        typeof error === "string" &&
        APPLE_ERRORS.has(error as AppleTokenFailure)
          ? (error as AppleTokenFailure)
          : "rejected",
    };
  }

  private async clientSecret(clientId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1_000);
    const cached = this.secrets.get(clientId);
    if (
      cached !== undefined &&
      cached.expiresAt - CLIENT_SECRET_REFRESH_MARGIN_SECONDS > now
    ) {
      return cached.value;
    }
    const { SignJWT } = await import("jose");
    const expiresAt = now + CLIENT_SECRET_TTL_SECONDS;
    const value = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.keyId })
      .setIssuer(this.teamId)
      .setIssuedAt(now)
      .setExpirationTime(expiresAt)
      .setAudience(APPLE_AUDIENCE)
      .setSubject(clientId)
      .sign(await this.key());
    this.secrets.set(clientId, { value, expiresAt });
    return value;
  }

  private key(): Promise<CryptoKey> {
    this.signingKey ??= import("jose").then(({ importPKCS8 }) =>
      importPKCS8(this.privateKey, "ES256"),
    );
    return this.signingKey;
  }
}
