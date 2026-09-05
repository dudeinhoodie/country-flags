import { createHash } from "node:crypto";

import {
  Environment,
  InAppOwnershipType,
  type JWSTransactionDecodedPayload,
  RevocationReason,
  SignedDataVerifier,
  Type,
  VerificationException,
  VerificationStatus,
} from "@apple/app-store-server-library";
import { Injectable } from "@nestjs/common";
import {
  StoreEnvironment,
  StoreOwnershipType,
  StoreProvider,
} from "@prisma/client";

import { AppleStoreConfig } from "./apple-store.config";
import {
  type AppleVerificationCode,
  AppleVerificationError,
} from "./apple-verification.error";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Compared as strings rather than as enum members: Apple types these payload
// fields as `Type | string`, because the store may name a kind this version of
// the library has never heard of, and an unknown kind must fall through to a
// refusal rather than to a type error.
const NON_CONSUMABLE: string = Type.NON_CONSUMABLE;
const PURCHASED: string = InAppOwnershipType.PURCHASED;

const APPLE_ENVIRONMENT: Record<StoreEnvironment, Environment> = {
  LOCAL_TEST: Environment.LOCAL_TESTING,
  SANDBOX: Environment.SANDBOX,
  PRODUCTION: Environment.PRODUCTION,
};

/**
 * Apple's own reason for a refund, kept as a name rather than the number it
 * arrives as: the ledger is read by people, and `1` tells them nothing.
 */
const REVOCATION_REASON: Record<number, string> = {
  [RevocationReason.REFUNDED_DUE_TO_ISSUE]: "REFUNDED_DUE_TO_ISSUE",
  [RevocationReason.REFUNDED_FOR_OTHER_REASON]: "REFUNDED_FOR_OTHER_REASON",
};

/**
 * What the library's failure statuses mean to us. Everything about a broken
 * chain, a bad certificate or a payload that will not decode is one answer —
 * the signature did not hold — because the difference is of no use to a
 * client and of no use to an alert either.
 */
const VERIFICATION_CODE: Record<VerificationStatus, AppleVerificationCode> = {
  [VerificationStatus.OK]: "SIGNATURE_INVALID",
  [VerificationStatus.VERIFICATION_FAILURE]: "SIGNATURE_INVALID",
  [VerificationStatus.RETRYABLE_VERIFICATION_FAILURE]:
    "VERIFICATION_UNAVAILABLE",
  [VerificationStatus.INVALID_APP_IDENTIFIER]: "APP_IDENTITY_MISMATCH",
  [VerificationStatus.INVALID_ENVIRONMENT]: "ENVIRONMENT_MISMATCH",
  [VerificationStatus.INVALID_CHAIN_LENGTH]: "SIGNATURE_INVALID",
  [VerificationStatus.INVALID_CERTIFICATE]: "SIGNATURE_INVALID",
  [VerificationStatus.FAILURE]: "SIGNATURE_INVALID",
};

/**
 * A purchase as the server established it, with the signed payload left
 * behind.
 *
 * Only the hash of the JWS survives verification. It is enough to prove later
 * that a ledger row came from the bytes a client actually sent, and it cannot
 * be replayed, printed in a log or handed to anybody.
 */
export interface VerifiedAppleTransaction {
  provider: StoreProvider;
  storeEnvironment: StoreEnvironment;
  bundleId: string;
  transactionId: string;
  originalTransactionId: string | null;
  productId: string;
  appAccountToken: string | null;
  ownershipType: StoreOwnershipType;
  purchasedAt: Date;
  revokedAt: Date | null;
  revocationReason: string | null;
  signedPayloadHash: string;
  verifiedAt: Date;
}

function requireString(
  value: string | undefined,
  code: AppleVerificationCode = "PAYLOAD_INCOMPLETE",
): string {
  if (value === undefined || value.length === 0) {
    throw new AppleVerificationError(code);
  }
  return value;
}

function requireDate(value: number | undefined): Date {
  if (value === undefined || !Number.isFinite(value)) {
    throw new AppleVerificationError("PAYLOAD_INCOMPLETE");
  }
  return new Date(value);
}

/**
 * The one place the Apple SDK is allowed to be imported.
 *
 * Everything above this line works with `VerifiedAppleTransaction`, which is
 * why the rest of the module needs no opinion about JWS, x5c chains or which
 * of Apple's four environments exist. What the boundary guarantees to its
 * callers:
 *
 * 1. the payload verified against Apple's root certificates;
 * 2. it was signed for this deployment's bundle identifier;
 * 3. it was signed in this deployment's store environment, so a Sandbox
 *    purchase cannot open a deck in production and a production purchase
 *    cannot open one in dev;
 * 4. it is a one-off purchase the customer made themselves;
 * 5. every field a ledger row needs is present and well formed.
 *
 * What it deliberately does not know: whether we sell that product, who is
 * claiming it, or what it grants. Those are questions for the database, and
 * asking them here would put the catalog inside the crypto.
 */
@Injectable()
export class AppleTransactionVerifier {
  private readonly verifier: SignedDataVerifier | null;

  constructor(private readonly store: AppleStoreConfig) {
    // Built once, at startup: a certificate an operator got wrong should stop
    // the process rather than turn into an unexplainable signature failure on
    // somebody's first purchase.
    this.verifier = store.configured
      ? new SignedDataVerifier(
          store.rootCertificates,
          store.onlineChecks,
          APPLE_ENVIRONMENT[store.storeEnvironment],
          store.bundleId,
          store.appAppleId ?? undefined,
        )
      : null;
  }

  get configured(): boolean {
    return this.verifier !== null;
  }

  async verify(signedTransaction: string): Promise<VerifiedAppleTransaction> {
    const verifier = this.verifier;
    if (verifier === null) {
      throw new AppleVerificationError("STORE_NOT_CONFIGURED");
    }

    let payload: JWSTransactionDecodedPayload;
    try {
      payload = await verifier.verifyAndDecodeTransaction(signedTransaction);
    } catch (error) {
      throw new AppleVerificationError(
        error instanceof VerificationException
          ? VERIFICATION_CODE[error.status]
          : "SIGNATURE_INVALID",
      );
    }

    return this.normalize(payload, signedTransaction);
  }

  private normalize(
    payload: JWSTransactionDecodedPayload,
    signedTransaction: string,
  ): VerifiedAppleTransaction {
    if (payload.type !== NON_CONSUMABLE) {
      throw new AppleVerificationError("PRODUCT_TYPE_UNSUPPORTED");
    }
    // Family Sharing cannot be turned off once it is turned on, so it is not
    // in this version and a shared copy grants nothing. Absent means the
    // ordinary case: the person who is asking is the person who paid.
    const ownership: string = payload.inAppOwnershipType ?? PURCHASED;
    if (ownership !== PURCHASED) {
      throw new AppleVerificationError("OWNERSHIP_TYPE_UNSUPPORTED");
    }

    const appAccountToken = payload.appAccountToken;
    if (appAccountToken !== undefined && !UUID_PATTERN.test(appAccountToken)) {
      throw new AppleVerificationError("APP_ACCOUNT_TOKEN_INVALID");
    }

    const revokedAt =
      payload.revocationDate === undefined
        ? null
        : new Date(payload.revocationDate);

    return {
      provider: StoreProvider.APPLE_APP_STORE,
      // Taken from the configuration rather than the payload: the library has
      // already refused anything signed for another environment, and reading
      // it back from the payload would only invite somebody to relax that
      // check one day and never notice.
      storeEnvironment: this.store.storeEnvironment,
      bundleId: this.store.bundleId,
      transactionId: requireString(payload.transactionId),
      originalTransactionId: payload.originalTransactionId ?? null,
      productId: requireString(payload.productId),
      appAccountToken: appAccountToken?.toLowerCase() ?? null,
      ownershipType: StoreOwnershipType.PURCHASED,
      purchasedAt: requireDate(payload.purchaseDate),
      revokedAt,
      revocationReason:
        revokedAt === null
          ? null
          : typeof payload.revocationReason === "number"
            ? (REVOCATION_REASON[payload.revocationReason] ??
              `APPLE_${payload.revocationReason}`)
            : "UNSPECIFIED",
      signedPayloadHash: createHash("sha256")
        .update(signedTransaction)
        .digest("hex"),
      verifiedAt: new Date(),
    };
  }
}
