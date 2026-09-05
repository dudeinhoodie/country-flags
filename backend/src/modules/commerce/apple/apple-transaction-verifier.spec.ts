import { createHash } from "node:crypto";

import { StoreEnvironment } from "@prisma/client";

import { AppleStoreConfig } from "./apple-store.config";
import { AppleTransactionVerifier } from "./apple-transaction-verifier";
import { AppleVerificationError } from "./apple-verification.error";
import { localTestSignedTransaction } from "./testing/local-store-transaction";

const BUNDLE_ID = "app.countryflags.mobile.local";
const PRODUCT_ID = "app.countryflags.deck.european_coats.lifetime.v1";
const ACCOUNT_TOKEN = "a0000000-0000-4000-8000-000000000001";

function storeConfig(
  overrides: Partial<AppleStoreConfig> = {},
): AppleStoreConfig {
  return {
    storeEnvironment: StoreEnvironment.LOCAL_TEST,
    bundleId: BUNDLE_ID,
    appAppleId: null,
    rootCertificates: [],
    onlineChecks: false,
    configured: true,
    ...overrides,
  };
}

async function codeOf(
  verifier: AppleTransactionVerifier,
  signedTransaction: string,
): Promise<string> {
  try {
    await verifier.verify(signedTransaction);
  } catch (error) {
    if (error instanceof AppleVerificationError) {
      return error.code;
    }
    throw error;
  }
  throw new Error("Expected the transaction to be refused");
}

describe("AppleTransactionVerifier", () => {
  const verifier = new AppleTransactionVerifier(storeConfig());

  it("normalizes a purchase into what a ledger row needs", async () => {
    const purchasedAt = new Date("2026-09-01T10:00:00.000Z");
    const signedTransaction = localTestSignedTransaction({
      transactionId: "2000000900000001",
      originalTransactionId: "2000000800000001",
      productId: PRODUCT_ID,
      bundleId: BUNDLE_ID,
      appAccountToken: ACCOUNT_TOKEN.toUpperCase(),
      purchaseDate: purchasedAt,
    });

    const purchase = await verifier.verify(signedTransaction);

    expect(purchase).toMatchObject({
      provider: "APPLE_APP_STORE",
      storeEnvironment: StoreEnvironment.LOCAL_TEST,
      bundleId: BUNDLE_ID,
      transactionId: "2000000900000001",
      originalTransactionId: "2000000800000001",
      productId: PRODUCT_ID,
      // Apple sends the token in whatever case the app generated it; the
      // column is a UUID and the comparison must not turn on capitals.
      appAccountToken: ACCOUNT_TOKEN,
      ownershipType: "PURCHASED",
      purchasedAt,
      revokedAt: null,
      revocationReason: null,
    });
    expect(purchase.signedPayloadHash).toBe(
      createHash("sha256").update(signedTransaction).digest("hex"),
    );
    // The payload is evidence, and evidence does not travel: only its hash
    // leaves the boundary, so no caller can log or replay the JWS.
    expect(JSON.stringify(purchase)).not.toContain(signedTransaction);
  });

  it("keeps the environment the deployment was configured with", async () => {
    const purchase = await verifier.verify(
      localTestSignedTransaction({
        transactionId: "2000000900000002",
        productId: PRODUCT_ID,
        bundleId: BUNDLE_ID,
      }),
    );

    expect(purchase.storeEnvironment).toBe(StoreEnvironment.LOCAL_TEST);
  });

  it("records a refund as a revocation with Apple's own reason", async () => {
    const revokedAt = new Date("2026-09-03T08:30:00.000Z");
    const purchase = await verifier.verify(
      localTestSignedTransaction({
        transactionId: "2000000900000003",
        productId: PRODUCT_ID,
        bundleId: BUNDLE_ID,
        revocationDate: revokedAt,
        revocationReason: 1,
      }),
    );

    expect(purchase.revokedAt).toEqual(revokedAt);
    expect(purchase.revocationReason).toBe("REFUNDED_DUE_TO_ISSUE");
  });

  it("refuses a transaction signed in another store environment", async () => {
    await expect(
      codeOf(
        verifier,
        localTestSignedTransaction({
          transactionId: "2000000900000004",
          productId: PRODUCT_ID,
          bundleId: BUNDLE_ID,
          environment: "Production",
        }),
      ),
    ).resolves.toBe("ENVIRONMENT_MISMATCH");

    await expect(
      codeOf(
        verifier,
        localTestSignedTransaction({
          transactionId: "2000000900000005",
          productId: PRODUCT_ID,
          bundleId: BUNDLE_ID,
          environment: "Sandbox",
        }),
      ),
    ).resolves.toBe("ENVIRONMENT_MISMATCH");
  });

  it("refuses a transaction signed for another app", async () => {
    await expect(
      codeOf(
        verifier,
        localTestSignedTransaction({
          transactionId: "2000000900000006",
          productId: PRODUCT_ID,
          bundleId: "app.countryflags.mobile.someone-else",
        }),
      ),
    ).resolves.toBe("APP_IDENTITY_MISMATCH");
  });

  it("refuses anything that is not a signed transaction", async () => {
    await expect(codeOf(verifier, "not-a-jws")).resolves.toBe(
      "SIGNATURE_INVALID",
    );
    await expect(codeOf(verifier, "aaaa.bbbb.cccc")).resolves.toBe(
      "SIGNATURE_INVALID",
    );
  });

  it("sells nothing but a one-off purchase the customer made themselves", async () => {
    await expect(
      codeOf(
        verifier,
        localTestSignedTransaction({
          transactionId: "2000000900000007",
          productId: PRODUCT_ID,
          bundleId: BUNDLE_ID,
          type: "Consumable",
        }),
      ),
    ).resolves.toBe("PRODUCT_TYPE_UNSUPPORTED");

    // Family Sharing cannot be switched off once it is on, so it is not in
    // this version and a shared copy opens nothing.
    await expect(
      codeOf(
        verifier,
        localTestSignedTransaction({
          transactionId: "2000000900000008",
          productId: PRODUCT_ID,
          bundleId: BUNDLE_ID,
          inAppOwnershipType: "FAMILY_SHARED",
        }),
      ),
    ).resolves.toBe("OWNERSHIP_TYPE_UNSUPPORTED");
  });

  it("refuses a payload missing what a ledger row is made of", async () => {
    await expect(
      codeOf(
        verifier,
        localTestSignedTransaction({
          transactionId: "2000000900000009",
          productId: PRODUCT_ID,
          bundleId: BUNDLE_ID,
          omit: ["transactionId"],
        }),
      ),
    ).resolves.toBe("PAYLOAD_INCOMPLETE");

    await expect(
      codeOf(
        verifier,
        localTestSignedTransaction({
          transactionId: "2000000900000010",
          productId: PRODUCT_ID,
          bundleId: BUNDLE_ID,
          omit: ["purchaseDate"],
        }),
      ),
    ).resolves.toBe("PAYLOAD_INCOMPLETE");
  });

  it("refuses an account token that is not a token", async () => {
    await expect(
      codeOf(
        verifier,
        localTestSignedTransaction({
          transactionId: "2000000900000011",
          productId: PRODUCT_ID,
          bundleId: BUNDLE_ID,
          appAccountToken: "not-a-uuid",
        }),
      ),
    ).resolves.toBe("APP_ACCOUNT_TOKEN_INVALID");
  });

  it("verifies nothing at all until the deployment has store credentials", async () => {
    const unconfigured = new AppleTransactionVerifier(
      storeConfig({ bundleId: "", configured: false }),
    );

    expect(unconfigured.configured).toBe(false);
    await expect(
      codeOf(
        unconfigured,
        localTestSignedTransaction({
          transactionId: "2000000900000012",
          productId: PRODUCT_ID,
          bundleId: BUNDLE_ID,
        }),
      ),
    ).resolves.toBe("STORE_NOT_CONFIGURED");
  });

  it("names an unfinished configuration as something to retry, not to reject", () => {
    expect(new AppleVerificationError("STORE_NOT_CONFIGURED").retryable).toBe(
      true,
    );
    expect(
      new AppleVerificationError("VERIFICATION_UNAVAILABLE").retryable,
    ).toBe(true);
    expect(new AppleVerificationError("SIGNATURE_INVALID").retryable).toBe(
      false,
    );
  });

  it("never puts the payload into the error it throws", async () => {
    const signedTransaction = localTestSignedTransaction({
      transactionId: "2000000900000013",
      productId: PRODUCT_ID,
      bundleId: "app.countryflags.mobile.someone-else",
      appAccountToken: ACCOUNT_TOKEN,
    });

    await expect(verifier.verify(signedTransaction)).rejects.toThrow(
      /APP_IDENTITY_MISMATCH/,
    );
    await expect(verifier.verify(signedTransaction)).rejects.not.toThrow(
      new RegExp(ACCOUNT_TOKEN),
    );
  });
});
