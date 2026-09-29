/**
 * Why a call to Apple's token endpoints did not succeed. Apple's own OAuth
 * error codes pass through; `unavailable` covers the network, timeouts and
 * 5xx, `malformed_response` an answer that could not be read.
 */
export type AppleTokenFailure =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "unsupported_token_type"
  | "unavailable"
  | "malformed_response"
  | "rejected";

export type AppleTokenExchange =
  | { kind: "exchanged"; refreshToken: string }
  | { kind: "not_configured" }
  | { kind: "failed"; reason: AppleTokenFailure };

export type AppleTokenRevocation =
  | { kind: "revoked" }
  | { kind: "not_configured" }
  | { kind: "failed"; reason: AppleTokenFailure };

/**
 * The Sign in with Apple REST API, as much of it as the account lifecycle
 * needs: turning a sign-in's authorization code into a refresh token, and
 * revoking that token when the account is deleted (docs/01 §5.1, §5.5).
 *
 * An abstract class so it can be the injection token: production binds the
 * REST adapter, tests bind a fake, and nothing in CI ever reaches Apple.
 * Implementations never throw for a failure Apple or the network caused;
 * they answer with it, because neither caller may fail on it.
 */
export abstract class AppleTokenClient {
  /** Whether the Sign in with Apple key is configured at all. */
  abstract get configured(): boolean;

  abstract exchangeAuthorizationCode(input: {
    clientId: string;
    authorizationCode: string;
  }): Promise<AppleTokenExchange>;

  abstract revokeRefreshToken(input: {
    clientId: string;
    refreshToken: string;
  }): Promise<AppleTokenRevocation>;
}
