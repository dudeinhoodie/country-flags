import { Injectable } from "@nestjs/common";
import { ProviderTokenState } from "@prisma/client";

import { JsonLoggerService } from "../../../common/logging/json-logger.service";
import { ProviderTokenCipher } from "../provider-token-cipher";
import type { VerifiedProviderIdentity } from "../provider-identity-verifier";
import { AppleTokenClient, type AppleTokenFailure } from "./apple-token.client";

/**
 * What a sign-in's code exchange leaves to be stored on the Apple identity.
 * A sealed token only ever comes with `STORED`.
 */
export interface AppleTokenGrant {
  state: ProviderTokenState;
  sealedRefreshToken: string | null;
  clientId: string | null;
}

/** The Apple identity's stored token, as account deletion reads it. */
export interface StoredAppleToken {
  providerSubject: string;
  providerTokenCiphertext: string | null;
  providerTokenClientId: string | null;
  providerTokenState: ProviderTokenState | null;
}

/**
 * What deleting the account did about Sign in with Apple, recorded in the
 * deletion audit. Only `revoked` means Apple no longer lists the app.
 */
export type AppleRevocationOutcome =
  | "revoked"
  | "revocation_failed"
  | "credentials_not_configured"
  | "no_token_stored"
  | "not_applicable_no_apple_identity";

export interface AppleRevocationResult {
  outcome: AppleRevocationOutcome;
  failure: AppleTokenFailure | "undecryptable" | null;
}

function sealContext(providerSubject: string): string {
  return `auth_identities:APPLE:${providerSubject}`;
}

/**
 * The Sign in with Apple token lifecycle (docs/01 §5.1, §5.5, issue #444):
 * a sign-in exchanges its authorization code for Apple's refresh token, which
 * is kept encrypted, and deleting the account revokes it.
 *
 * Neither step can block what it is part of. A person must be able to sign
 * in while Apple's token endpoint is down, and must be able to delete their
 * account while the revoke endpoint is. Every outcome that is not the happy
 * one is therefore stated, logged and stored instead: on the identity for a
 * sign-in, in the deletion audit for a deletion. A deployment without the
 * Sign in with Apple key (dev and CI today, #302) says
 * `credentials_not_configured` every time rather than pretending it revoked
 * anything.
 */
@Injectable()
export class AppleTokenLifecycle {
  constructor(
    private readonly client: AppleTokenClient,
    private readonly cipher: ProviderTokenCipher,
    private readonly logger: JsonLoggerService,
  ) {}

  get configured(): boolean {
    return this.client.configured && this.cipher.configured;
  }

  async exchange(
    identity: VerifiedProviderIdentity,
    authorizationCode: string,
    requestId: string,
  ): Promise<AppleTokenGrant> {
    const clientId = identity.audience;
    if (!this.configured) {
      this.logger.warn({
        message:
          "Sign in with Apple credentials are not configured; the authorization code was not exchanged",
        event: "apple_code_exchange_skipped",
        outcome: "credentials_not_configured",
        requestId,
      });
      return this.withoutToken(ProviderTokenState.CREDENTIALS_NOT_CONFIGURED);
    }
    if (clientId === null) {
      return this.failedExchange("malformed_response", requestId);
    }
    const result = await this.client.exchangeAuthorizationCode({
      clientId,
      authorizationCode,
    });
    if (result.kind === "not_configured") {
      return this.withoutToken(ProviderTokenState.CREDENTIALS_NOT_CONFIGURED);
    }
    if (result.kind === "failed") {
      return this.failedExchange(result.reason, requestId);
    }
    return {
      state: ProviderTokenState.STORED,
      sealedRefreshToken: this.cipher.seal(
        result.refreshToken,
        sealContext(identity.subject),
      ),
      clientId,
    };
  }

  /**
   * Revokes the identity's Apple token as part of deleting the account.
   * Never throws: the deletion goes ahead whatever Apple says, and the
   * outcome is what the audit records.
   */
  async revoke(
    identity: StoredAppleToken | null,
    requestId: string,
  ): Promise<AppleRevocationResult> {
    if (identity === null) {
      return { outcome: "not_applicable_no_apple_identity", failure: null };
    }
    if (!this.configured) {
      this.logger.warn({
        message:
          "Sign in with Apple credentials are not configured; the Apple authorization was not revoked",
        event: "apple_revocation_skipped",
        outcome: "credentials_not_configured",
        requestId,
      });
      return { outcome: "credentials_not_configured", failure: null };
    }
    if (
      identity.providerTokenCiphertext === null ||
      identity.providerTokenClientId === null
    ) {
      this.logger.warn({
        message:
          "No Apple refresh token is stored for this identity; the Apple authorization was not revoked",
        event: "apple_revocation_skipped",
        outcome: "no_token_stored",
        exchangeState: identity.providerTokenState,
        requestId,
      });
      return { outcome: "no_token_stored", failure: null };
    }
    let refreshToken: string;
    try {
      refreshToken = this.cipher.open(
        identity.providerTokenCiphertext,
        sealContext(identity.providerSubject),
      );
    } catch {
      return this.failedRevocation("undecryptable", requestId);
    }
    const result = await this.client.revokeRefreshToken({
      clientId: identity.providerTokenClientId,
      refreshToken,
    });
    if (result.kind === "revoked") {
      this.logger.log({
        message: "Apple authorization revoked",
        event: "apple_revocation_succeeded",
        requestId,
      });
      return { outcome: "revoked", failure: null };
    }
    if (result.kind === "not_configured") {
      return { outcome: "credentials_not_configured", failure: null };
    }
    return this.failedRevocation(result.reason, requestId);
  }

  private withoutToken(state: ProviderTokenState): AppleTokenGrant {
    return { state, sealedRefreshToken: null, clientId: null };
  }

  private failedExchange(
    failure: AppleTokenFailure,
    requestId: string,
  ): AppleTokenGrant {
    // A warning, not an error: the person is signed in all the same, and the
    // deletion audit will say there was no token to revoke.
    this.logger.warn({
      message:
        "Apple authorization code exchange failed; the sign-in continues without a revocable token",
      event: "apple_code_exchange_failed",
      failure,
      requestId,
    });
    return this.withoutToken(ProviderTokenState.EXCHANGE_FAILED);
  }

  private failedRevocation(
    failure: AppleTokenFailure | "undecryptable",
    requestId: string,
  ): AppleRevocationResult {
    // Loud: the account is deleted, the app stays listed under the person's
    // Apple ID, and nothing will try again.
    this.logger.error({
      message: "Apple authorization revocation failed",
      event: "apple_revocation_failed",
      failure,
      requestId,
    });
    return { outcome: "revocation_failed", failure };
  }
}
