import type {
  CommerceOffer,
  CommerceOfferGrant,
  CommerceOfferLocalization,
  EntitlementStatus,
  StoreProduct,
  StoreSyncRun,
  StoreTransaction,
} from "@prisma/client";

/**
 * The stored rows as the admin contract shapes them.
 *
 * No mapper here emits a price, and none can: no commerce table has such a
 * column. What a thing costs is the store's answer, read in the store's own
 * currency for the customer's own storefront, and a number repeated here
 * would be a promise this system cannot keep (17-paid-decks-storekit §12.4).
 */

export interface OfferWithRelations extends CommerceOffer {
  grants: CommerceOfferGrant[];
  localizations: CommerceOfferLocalization[];
  products: StoreProduct[];
}

export interface EntitlementSummary {
  key: string;
  status: EntitlementStatus;
  description: string | null;
}

export function apiEntitlement(
  entitlement: EntitlementSummary,
  deckCodes: string[],
): Record<string, unknown> {
  return {
    key: entitlement.key,
    status: entitlement.status,
    description: entitlement.description,
    deckCodes,
  };
}

export function apiStoreProduct(
  product: StoreProduct,
): Record<string, unknown> {
  return {
    id: product.id,
    provider: product.provider,
    storeEnvironment: product.storeEnvironment,
    bundleId: product.bundleId,
    productId: product.productId,
    productType: product.productType,
    status: product.status,
    storeStatus: product.storeStatus,
    lastValidatedAt: product.lastValidatedAt?.toISOString() ?? null,
    validationError: product.validationError,
  };
}

export function apiOffer(offer: OfferWithRelations): Record<string, unknown> {
  const localizations: Record<string, { name: string; description: string }> =
    {};
  for (const localization of offer.localizations) {
    localizations[localization.locale] = {
      name: localization.title,
      description: localization.description,
    };
  }
  return {
    id: offer.id,
    code: offer.code,
    kind: offer.kind,
    status: offer.status,
    sortOrder: offer.sortOrder,
    notes: offer.notes,
    grants: offer.grants.map((grant) => grant.entitlementKey).sort(),
    localizations,
    products: offer.products.map(apiStoreProduct),
  };
}

export function apiStoreSyncRun(run: StoreSyncRun): Record<string, unknown> {
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    checkedProductCount: run.checkedProductCount,
    failureMessage: run.failureMessage,
  };
}

/**
 * Enough of a store identifier to match a support ticket against, and not
 * enough to replay anywhere.
 *
 * The length is fixed rather than proportional: a mask that got longer with
 * the identifier would leak how long the identifier is, and a short one
 * would be mostly readable.
 */
export function maskStoreIdentifier(identifier: string): string {
  const tail = identifier.slice(-4);
  return `****${tail}`;
}

export function apiStoreTransaction(
  transaction: StoreTransaction,
  grantedEntitlementKeys: string[],
): Record<string, unknown> {
  return {
    id: transaction.id,
    provider: transaction.provider,
    storeEnvironment: transaction.storeEnvironment,
    maskedTransactionId: maskStoreIdentifier(transaction.transactionId),
    productId: transaction.productId,
    claimState: transaction.claimState,
    ownershipType: transaction.ownershipType,
    purchasedAt: transaction.purchasedAt.toISOString(),
    revokedAt: transaction.revokedAt?.toISOString() ?? null,
    revocationReason: transaction.revocationReason,
    grantedEntitlementKeys,
    // Deliberately absent: the signed payload and its hash, the store account
    // token, and the account behind the purchase. Support needs to know that
    // a purchase landed and what it opened, and a signed receipt in a console
    // screenshot is a receipt somebody else can present.
  };
}
