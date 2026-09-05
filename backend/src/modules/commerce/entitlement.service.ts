import { createHash } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import {
  EntitlementGrantSource,
  EntitlementGrantStatus,
  type Prisma,
  StoreProductStatus,
  StoreTransactionClaimState,
  StoreProductType,
  UserStatus,
} from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { JsonLoggerService } from "../../common/logging/json-logger.service";
import { MetricsService } from "../../common/telemetry/metrics.service";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { inSerializableTransaction } from "../../infrastructure/database/serializable-transaction";
import { AppleTransactionVerifier } from "./apple/apple-transaction-verifier";
import type { VerifiedAppleTransaction } from "./apple/apple-transaction-verifier";
import {
  type AppleVerificationCode,
  AppleVerificationError,
} from "./apple/apple-verification.error";

/**
 * Everything an account may open, and when the server last said so.
 *
 * `checkedAt` is when this answer was established and moves on every call;
 * the entity tag covers only the rights themselves, so a client that asks on
 * every foreground gets a 304 until something it owns actually changes.
 */
export interface EntitlementSnapshot {
  entitlementKeys: string[];
  checkedAt: Date;
  etag: string;
}

/** The part of the database this service reads and writes. */
type EntitlementReader = Pick<PrismaService, "userEntitlementGrant">;

/**
 * A transaction identifier as it may be spoken about: enough for support to
 * find the row, not enough to be anybody's evidence. Used in refusals and in
 * logs, where the full identifier is forbidden (§16).
 */
export function maskTransactionReference(transactionId: string): string {
  return `****${transactionId.slice(-4)}`;
}

export function entitlementEtag(entitlementKeys: readonly string[]): string {
  const digest = createHash("sha256")
    .update([...entitlementKeys].sort().join("\n"))
    .digest("hex");
  return `"${digest.slice(0, 32)}"`;
}

function verificationRefusal(
  error: AppleVerificationError,
  transactionReference: string | null,
): ApiException {
  const details =
    transactionReference === null
      ? { reason: error.code }
      : { reason: error.code, transactionReference };
  return error.retryable
    ? new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "STORE_VERIFICATION_UNAVAILABLE",
        "The purchase could not be verified right now",
        details,
      )
    : new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "TRANSACTION_VERIFICATION_FAILED",
        "The submitted transaction was not accepted",
        details,
      );
}

/**
 * A purchase claimed by somebody else. It says which transaction — the client
 * sent it, so that is not news — and nothing whatsoever about the account
 * holding it: not an identifier, not an initial, not whether the address is
 * one the customer would recognize (§15.3). Support works from the masked
 * reference and the request id in the envelope.
 */
function boundToAnotherAccount(transactionId: string): ApiException {
  return new ApiException(
    HttpStatus.CONFLICT,
    "PURCHASE_BOUND_TO_ANOTHER_ACCOUNT",
    "This purchase is already attached to another account",
    { transactionReference: maskTransactionReference(transactionId) },
  );
}

/**
 * What a purchase turns into, and who is allowed to hold it.
 *
 * The rule the whole of this file exists to keep: **nothing about what a
 * transaction is worth is read from the request**. The client sends signed
 * bytes and nothing else — no deck, no offer code, no entitlement key, no
 * price — and the server reads the product out of the payload, maps it
 * through its own catalog, and grants what that mapping says. A client that
 * lies can only lie about which purchase it holds, and the signature settles
 * that.
 */
@Injectable()
export class EntitlementService {
  constructor(
    private readonly database: PrismaService,
    private readonly verifier: AppleTransactionVerifier,
    private readonly logger: JsonLoggerService,
    private readonly metrics: MetricsService,
  ) {}

  async snapshot(
    userId: string,
    reader: EntitlementReader = this.database,
  ): Promise<EntitlementSnapshot> {
    const grants = await reader.userEntitlementGrant.findMany({
      where: { userId, status: EntitlementGrantStatus.ACTIVE },
      select: { entitlementKey: true },
      distinct: ["entitlementKey"],
      orderBy: { entitlementKey: "asc" },
    });
    const entitlementKeys = grants.map(({ entitlementKey }) => entitlementKey);
    return {
      entitlementKeys,
      checkedAt: new Date(),
      etag: entitlementEtag(entitlementKeys),
    };
  }

  /**
   * The purchase path, in the order §7.1 sets out: verify the signature,
   * the app and the environment; find the product we sell; check it is a
   * one-off purchase; match the account token on a first claim; apply the
   * transaction once; grant or revoke; answer with the whole current
   * snapshot rather than a delta, because the client replaces its local
   * state with this atomically.
   *
   * The batch is all or nothing. A purchase, the transaction listener and a
   * restore all arrive here, and every one of them submits transactions this
   * app record produced; a payload that does not verify is therefore a
   * misconfiguration or an attack, and applying its neighbours while
   * quietly dropping it would hide both.
   */
  async submitAppleTransactions(
    userId: string,
    signedTransactions: readonly string[],
    requestId: string,
  ): Promise<EntitlementSnapshot> {
    const verified: VerifiedAppleTransaction[] = [];
    for (const signedTransaction of signedTransactions) {
      verified.push(await this.verifyOne(signedTransaction, requestId));
    }

    return inSerializableTransaction(this.database, async (transaction) => {
      for (const purchase of verified) {
        await this.apply(transaction, userId, purchase, requestId);
      }
      return this.snapshot(userId, transaction);
    });
  }

  /**
   * Deleting an account releases its purchases instead of destroying them.
   *
   * A non-consumable belongs to the Apple Account that paid for it, and that
   * account still exists after ours is gone; the ledger therefore keeps the
   * row and forgets who was holding it. `RELEASED_BY_ACCOUNT_DELETION` is the
   * only state a verified restore may bind to a new account from — a purchase
   * held by a live account is never moved automatically, whoever asks (§15.4).
   */
  async releaseOnAccountDeletion(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<{ entitlementGrants: number; storeTransactions: number }> {
    const entitlementGrants = await transaction.userEntitlementGrant.deleteMany(
      { where: { userId } },
    );
    const storeTransactions = await transaction.storeTransaction.updateMany({
      where: { userId },
      data: {
        userId: null,
        claimState: StoreTransactionClaimState.RELEASED_BY_ACCOUNT_DELETION,
      },
    });
    return {
      entitlementGrants: entitlementGrants.count,
      storeTransactions: storeTransactions.count,
    };
  }

  /**
   * A purchase Apple told us about, rather than one a client submitted.
   *
   * There is no session here, so the account is found the only two honest
   * ways: the ledger already knows who holds this transaction, or the
   * signed payload names an account token that is somebody's. Neither
   * answer available means the notification arrived before its purchase
   * ever reached us — which is a thing to quarantine and look at, not a
   * thing to guess.
   */
  async applyFromNotification(
    purchase: VerifiedAppleTransaction,
    requestId: string,
  ): Promise<"applied" | "UNKNOWN_PRODUCT" | "UNKNOWN_ACCOUNT"> {
    const userId = await this.resolveHolder(purchase);
    if (userId === null) {
      return "UNKNOWN_ACCOUNT";
    }
    try {
      await inSerializableTransaction(this.database, async (transaction) => {
        await this.apply(transaction, userId, purchase, requestId);
      });
      return "applied";
    } catch (error) {
      // `apply` refuses a product this deployment does not sell by throwing
      // the same typed refusal the client path returns. From a notification
      // that is not a bad request — it is a mapping that has to be fixed by
      // a human, and the row says so.
      if (error instanceof ApiException) {
        const envelope = error.getResponse() as {
          error?: { code?: string; details?: { reason?: string } };
        };
        if (envelope.error?.details?.reason === "UNKNOWN_PRODUCT") {
          return "UNKNOWN_PRODUCT";
        }
      }
      throw error;
    }
  }

  private async resolveHolder(
    purchase: VerifiedAppleTransaction,
  ): Promise<string | null> {
    const existing = await this.database.storeTransaction.findUnique({
      where: {
        provider_storeEnvironment_transactionId: {
          provider: purchase.provider,
          storeEnvironment: purchase.storeEnvironment,
          transactionId: purchase.transactionId,
        },
      },
      select: { userId: true },
    });
    if (existing?.userId != null) {
      return existing.userId;
    }
    if (purchase.appAccountToken === null) {
      return null;
    }
    const user = await this.database.user.findUnique({
      where: { storeAccountToken: purchase.appAccountToken },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  private async verifyOne(
    signedTransaction: string,
    requestId: string,
  ): Promise<VerifiedAppleTransaction> {
    try {
      const purchase = await this.verifier.verify(signedTransaction);
      this.metrics.recordStoreTransactionVerification("VERIFIED");
      return purchase;
    } catch (error) {
      if (!(error instanceof AppleVerificationError)) {
        throw error;
      }
      // No transaction reference: nothing in an unverified payload has been
      // established, so there is nothing here worth quoting back.
      this.refused(error.code, requestId, null, null);
      throw verificationRefusal(error, null);
    }
  }

  private async apply(
    transaction: Prisma.TransactionClient,
    userId: string,
    purchase: VerifiedAppleTransaction,
    requestId: string,
  ): Promise<void> {
    const product = await transaction.storeProduct.findUnique({
      where: {
        provider_storeEnvironment_bundleId_productId: {
          provider: purchase.provider,
          storeEnvironment: purchase.storeEnvironment,
          bundleId: purchase.bundleId,
          productId: purchase.productId,
        },
      },
      select: {
        productType: true,
        status: true,
        offer: { select: { grants: { select: { entitlementKey: true } } } },
      },
    });
    // A product removed from sale still confirms the rights of everybody who
    // already bought it (§2.4), so status is not consulted here: a RETIRED
    // row is a listing decision, and this is a purchase that already
    // happened. Only INVALID is refused, because it means the mapping itself
    // is not trusted.
    if (product === null || product.status === StoreProductStatus.INVALID) {
      this.reject("UNKNOWN_PRODUCT", purchase, requestId);
    }
    if (product.productType !== StoreProductType.NON_CONSUMABLE) {
      this.reject("PRODUCT_TYPE_UNSUPPORTED", purchase, requestId);
    }

    const existing = await transaction.storeTransaction.findUnique({
      where: {
        provider_storeEnvironment_transactionId: {
          provider: purchase.provider,
          storeEnvironment: purchase.storeEnvironment,
          transactionId: purchase.transactionId,
        },
      },
      select: { id: true, userId: true, claimState: true },
    });
    await this.assertClaimable(transaction, userId, purchase, existing);

    const revoked = purchase.revokedAt !== null;
    const ledgerRow =
      existing === null
        ? await transaction.storeTransaction.create({
            data: {
              provider: purchase.provider,
              storeEnvironment: purchase.storeEnvironment,
              transactionId: purchase.transactionId,
              originalTransactionId: purchase.originalTransactionId,
              productId: purchase.productId,
              storeAccountToken: purchase.appAccountToken,
              userId,
              ownershipType: purchase.ownershipType,
              purchasedAt: purchase.purchasedAt,
              revokedAt: purchase.revokedAt,
              revocationReason: purchase.revocationReason,
              signedPayloadHash: purchase.signedPayloadHash,
              verifiedAt: purchase.verifiedAt,
              claimState: StoreTransactionClaimState.CLAIMED,
            },
            select: { id: true },
          })
        : await transaction.storeTransaction.update({
            where: { id: existing.id },
            // Only what a second delivery of the same purchase can honestly
            // change: who holds it after a release, whether Apple has since
            // revoked it, and when we last looked. Replaying a transaction
            // adds no row and rewrites no history.
            data: {
              userId,
              claimState: StoreTransactionClaimState.CLAIMED,
              revokedAt: purchase.revokedAt,
              revocationReason: purchase.revocationReason,
              verifiedAt: purchase.verifiedAt,
            },
            select: { id: true },
          });

    for (const { entitlementKey } of product.offer.grants) {
      await this.settleGrant(
        transaction,
        userId,
        entitlementKey,
        ledgerRow.id,
        revoked,
        purchase,
      );
    }

    this.logger.log({
      message: "Store transaction applied",
      event: "store_transaction_applied",
      requestId,
      provider: purchase.provider,
      storeEnvironment: purchase.storeEnvironment,
      productId: purchase.productId,
      transactionReference: maskTransactionReference(purchase.transactionId),
      outcome: revoked ? "REVOKED" : "GRANTED",
      firstClaim: existing === null,
    });
  }

  /**
   * Whether this account may hold this purchase.
   *
   * Three answers, and only three:
   *
   * - it is already ours, or nobody's — go ahead, and a second delivery of
   *   the same purchase lands as the same row;
   * - it was released when its owner deleted their account — a verified
   *   restore may take it, which is the one path by which a purchase changes
   *   hands;
   * - it belongs to a live account — refused, with nothing said about that
   *   account. There is no automatic transfer between two live accounts, and
   *   the Apple Account's own email is never compared with the login email:
   *   they are different identities and a match would prove nothing.
   */
  private async assertClaimable(
    transaction: Prisma.TransactionClient,
    userId: string,
    purchase: VerifiedAppleTransaction,
    existing: {
      userId: string | null;
      claimState: StoreTransactionClaimState;
    } | null,
  ): Promise<void> {
    if (existing !== null) {
      if (existing.userId === userId) {
        return;
      }
      if (existing.claimState === StoreTransactionClaimState.QUARANTINED) {
        throw boundToAnotherAccount(purchase.transactionId);
      }
      if (
        existing.userId !== null &&
        (await this.isLiveAccount(transaction, existing.userId))
      ) {
        throw boundToAnotherAccount(purchase.transactionId);
      }
      return;
    }

    // First claim. The token was minted by us, put into the purchase by the
    // app and signed by Apple, so it says which of our accounts paid — but
    // only while that account is still live. A token belonging to a deleted
    // account names nobody, and refusing there would strand a purchase whose
    // owner left before ever reaching this endpoint.
    const token = purchase.appAccountToken;
    if (token === null) {
      return;
    }
    const owner = await transaction.user.findUnique({
      where: { storeAccountToken: token },
      select: { id: true, status: true },
    });
    if (
      owner !== null &&
      owner.id !== userId &&
      owner.status === UserStatus.ACTIVE
    ) {
      throw boundToAnotherAccount(purchase.transactionId);
    }
  }

  private async isLiveAccount(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<boolean> {
    const user = await transaction.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    return user !== null && user.status === UserStatus.ACTIVE;
  }

  /**
   * One grant per right per purchase, created once and afterwards only
   * turned on or off. Access is the existence of at least one active grant,
   * so refunding one of two purchases that both grant a key leaves the key
   * granted and no caller has to work out which purchase won.
   */
  private async settleGrant(
    transaction: Prisma.TransactionClient,
    userId: string,
    entitlementKey: string,
    sourceTransactionId: string,
    revoked: boolean,
    purchase: VerifiedAppleTransaction,
  ): Promise<void> {
    const status = revoked
      ? EntitlementGrantStatus.REVOKED
      : EntitlementGrantStatus.ACTIVE;
    const revocation = revoked
      ? {
          revokedAt: purchase.revokedAt,
          revocationReason: purchase.revocationReason,
        }
      : { revokedAt: null, revocationReason: null };

    await transaction.userEntitlementGrant.upsert({
      where: {
        userId_entitlementKey_sourceType_sourceTransactionId: {
          userId,
          entitlementKey,
          sourceType: EntitlementGrantSource.STORE_TRANSACTION,
          sourceTransactionId,
        },
      },
      create: {
        userId,
        entitlementKey,
        sourceType: EntitlementGrantSource.STORE_TRANSACTION,
        sourceTransactionId,
        status,
        ...revocation,
      },
      update: { status, ...revocation },
      select: { id: true },
    });
  }

  private reject(
    code: AppleVerificationCode,
    purchase: VerifiedAppleTransaction,
    requestId: string,
  ): never {
    const reference = maskTransactionReference(purchase.transactionId);
    this.refused(code, requestId, reference, purchase.productId);
    throw verificationRefusal(new AppleVerificationError(code), reference);
  }

  private refused(
    code: AppleVerificationCode,
    requestId: string,
    transactionReference: string | null,
    productId: string | null,
  ): void {
    this.metrics.recordStoreTransactionVerification(code);
    this.logger.warn({
      message: "Store transaction refused",
      event: "store_transaction_refused",
      requestId,
      reason: code,
      ...(productId === null ? {} : { productId }),
      ...(transactionReference === null ? {} : { transactionReference }),
    });
  }
}
