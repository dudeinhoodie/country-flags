import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import {
  Environment,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
} from "@apple/app-store-server-library";
import type { ResponseBodyV2DecodedPayload } from "@apple/app-store-server-library";
import { StoreEnvironment } from "@prisma/client";

import { AppleStoreConfig } from "./apple-store.config";
import {
  AppleTransactionVerifier,
  type VerifiedAppleTransaction,
} from "./apple-transaction-verifier";
import {
  AppleVerificationError,
  type AppleVerificationCode,
} from "./apple-verification.error";

const APPLE_ENVIRONMENT: Record<StoreEnvironment, Environment> = {
  LOCAL_TEST: Environment.LOCAL_TESTING,
  SANDBOX: Environment.SANDBOX,
  PRODUCTION: Environment.PRODUCTION,
};

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
 * What Apple said happened, once the signature has been checked.
 *
 * The payload itself does not survive: a notification carries a whole
 * transaction inside it, and keeping the bytes would put a replayable
 * purchase in the log of every refund. The hash is enough to prove later
 * that a row came from what Apple actually sent.
 */
export interface VerifiedAppleNotification {
  notificationUuid: string;
  notificationType: string;
  subtype: string | null;
  signedDate: Date | null;
  payloadHash: string;
  /**
   * The purchase the notification is about, when it carries one and that
   * purchase is itself something this deployment can accept. A notification
   * about a transaction we cannot verify — a Family Sharing copy, another
   * environment — arrives with this null and is quarantined rather than
   * acted on.
   */
  transaction: VerifiedAppleTransaction | null;
  /** Why the inner transaction was not accepted, when it was not. */
  transactionRefusal: AppleVerificationCode | null;
}

/**
 * The second place the Apple SDK is allowed to be imported, and the reason
 * it is separate from the first: a notification is Apple talking to us
 * unprompted, and it is the only path by which a refund is learned quickly.
 *
 * The signature is checked before anything at all is written down. An
 * unsigned body is not a notification that failed to process — it is not a
 * notification, and it leaves no row behind.
 */
@Injectable()
export class AppleNotificationVerifier {
  private readonly verifier: SignedDataVerifier | null;

  constructor(
    private readonly store: AppleStoreConfig,
    private readonly transactions: AppleTransactionVerifier,
  ) {
    // Built the same way and at the same moment as the transaction
    // verifier's: the two check the same app, in the same environment,
    // against the same roots, and an operator who got a certificate wrong
    // should learn it at startup rather than during a refund.
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

  async verify(signedPayload: string): Promise<VerifiedAppleNotification> {
    const verifier = this.verifier;
    if (verifier === null) {
      throw new AppleVerificationError("STORE_NOT_CONFIGURED");
    }

    let payload: ResponseBodyV2DecodedPayload;
    try {
      payload = await verifier.verifyAndDecodeNotification(signedPayload);
    } catch (error) {
      throw new AppleVerificationError(
        error instanceof VerificationException
          ? VERIFICATION_CODE[error.status]
          : "SIGNATURE_INVALID",
      );
    }

    const notificationUuid = payload.notificationUUID;
    const notificationType = payload.notificationType;
    if (
      notificationUuid === undefined ||
      notificationUuid.length === 0 ||
      notificationType === undefined
    ) {
      throw new AppleVerificationError("PAYLOAD_INCOMPLETE");
    }

    const signedTransaction = payload.data?.signedTransactionInfo;
    let transaction: VerifiedAppleTransaction | null = null;
    let transactionRefusal: AppleVerificationCode | null = null;
    if (signedTransaction !== undefined && signedTransaction.length > 0) {
      try {
        transaction = await this.transactions.verify(signedTransaction);
      } catch (error) {
        if (!(error instanceof AppleVerificationError)) {
          throw error;
        }
        // The notification's own signature held; the purchase inside it is
        // something this deployment does not accept. That is a fact worth
        // recording, not a reason to refuse Apple's delivery — refusing
        // would make Apple retry forever.
        transactionRefusal = error.code;
      }
    }

    return {
      notificationUuid,
      notificationType: String(notificationType),
      subtype: payload.subtype === undefined ? null : String(payload.subtype),
      signedDate:
        payload.signedDate === undefined ? null : new Date(payload.signedDate),
      payloadHash: createHash("sha256").update(signedPayload).digest("hex"),
      transaction,
      transactionRefusal,
    };
  }

  /** Which store this deployment listens for, for the record it writes. */
  get storeEnvironment(): StoreEnvironment {
    return this.store.storeEnvironment;
  }
}
