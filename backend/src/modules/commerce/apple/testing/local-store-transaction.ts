/**
 * TEST_ONLY. Builds the kind of signed transaction StoreKit's local testing
 * configuration produces: a well-formed JWS whose signature Apple never made
 * and which only a `LOCAL_TEST` deployment will look at.
 *
 * This is the reason `LOCAL_TEST` may never be selected by a hosted
 * deployment — anybody could write this function. `resolveAppleStoreEnvironment`
 * is what makes that impossible, and the whole point of building these here
 * is that a test can prove the purchase path end to end without asking Apple
 * to sign anything.
 */
export interface LocalStoreTransactionOptions {
  transactionId: string;
  productId: string;
  bundleId: string;
  environment?: string;
  type?: string;
  inAppOwnershipType?: string;
  appAccountToken?: string;
  originalTransactionId?: string;
  purchaseDate?: Date;
  revocationDate?: Date;
  revocationReason?: number;
  omit?: readonly string[];
}

function segment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function localTestSignedTransaction(
  options: LocalStoreTransactionOptions,
): string {
  const purchaseDate = (options.purchaseDate ?? new Date()).getTime();
  const payload: Record<string, unknown> = {
    transactionId: options.transactionId,
    originalTransactionId:
      options.originalTransactionId ?? options.transactionId,
    bundleId: options.bundleId,
    productId: options.productId,
    purchaseDate,
    originalPurchaseDate: purchaseDate,
    quantity: 1,
    type: options.type ?? "Non-Consumable",
    inAppOwnershipType: options.inAppOwnershipType ?? "PURCHASED",
    signedDate: purchaseDate,
    environment: options.environment ?? "LocalTesting",
    ...(options.appAccountToken === undefined
      ? {}
      : { appAccountToken: options.appAccountToken }),
    ...(options.revocationDate === undefined
      ? {}
      : { revocationDate: options.revocationDate.getTime() }),
    ...(options.revocationReason === undefined
      ? {}
      : { revocationReason: options.revocationReason }),
  };
  for (const field of options.omit ?? []) {
    delete payload[field];
  }

  // No x5c: a local testing payload carries no certificate chain, which is
  // exactly why every other environment refuses it.
  return [
    segment({ alg: "ES256", typ: "JWT" }),
    segment(payload),
    "TEST_ONLY_not_a_signature",
  ].join(".");
}
