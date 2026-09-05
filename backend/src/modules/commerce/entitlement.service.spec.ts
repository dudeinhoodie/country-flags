import { StoreEnvironment, UserStatus } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import type { JsonLoggerService } from "../../common/logging/json-logger.service";
import type { MetricsService } from "../../common/telemetry/metrics.service";
import type { PrismaService } from "../../infrastructure/database/prisma.service";
import { AppleStoreConfig } from "./apple/apple-store.config";
import { AppleTransactionVerifier } from "./apple/apple-transaction-verifier";
import { localTestSignedTransaction } from "./apple/testing/local-store-transaction";
import {
  EntitlementService,
  entitlementEtag,
  maskTransactionReference,
} from "./entitlement.service";

const BUNDLE_ID = "app.countryflags.mobile.local";
const PRODUCT_ID = "app.countryflags.deck.european_coats.lifetime.v1";
const ENTITLEMENT_KEY = "entitlement.european_coats";
const OWNER = "80000000-0000-4000-8000-000000000001";
const STRANGER = "80000000-0000-4000-8000-000000000002";
const OWNER_TOKEN = "a0000000-0000-4000-8000-000000000001";
const STRANGER_TOKEN = "a0000000-0000-4000-8000-000000000002";
const TRANSACTION_ID = "2000000900000001";
const LEDGER_ROW_ID = "60000000-0000-4000-8000-000000000001";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function storeConfig(): AppleStoreConfig {
  return {
    storeEnvironment: StoreEnvironment.LOCAL_TEST,
    bundleId: BUNDLE_ID,
    appAppleId: null,
    rootCertificates: [],
    onlineChecks: false,
    localTestAllowed: true,
    configured: true,
  };
}

/** The first argument the mock was called with, typed by the caller. */
function firstCall<T>(mock: jest.Mock): T {
  const [call] = mock.mock.calls as unknown as T[][];
  if (call === undefined || call[0] === undefined) {
    throw new Error("Expected the database to have been called");
  }
  return call[0];
}

function purchase(
  overrides: Partial<Parameters<typeof localTestSignedTransaction>[0]> = {},
): string {
  return localTestSignedTransaction({
    transactionId: TRANSACTION_ID,
    productId: PRODUCT_ID,
    bundleId: BUNDLE_ID,
    ...overrides,
  });
}

interface Refusal {
  status: number;
  code: string;
  details: Record<string, unknown>;
}

async function refused(promise: Promise<unknown>): Promise<Refusal> {
  return promise.then(() => {
    throw new Error("Expected the submission to be refused");
  }, refusalOf);
}

function refusalOf(error: unknown): Refusal {
  if (!(error instanceof ApiException)) {
    throw new Error(`Expected an ApiException, received ${String(error)}`);
  }
  const body = error.getResponse() as {
    error: { code: string; details: Record<string, unknown> };
  };
  return {
    status: error.getStatus(),
    code: body.error.code,
    details: body.error.details,
  };
}

describe("EntitlementService", () => {
  const transaction = {
    storeProduct: { findUnique: jest.fn() },
    storeTransaction: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    userEntitlementGrant: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const database = {
    ...transaction,
    $transaction: jest.fn(async (run: (client: unknown) => Promise<unknown>) =>
      run(transaction),
    ),
  };
  const logger = { log: jest.fn(), warn: jest.fn() };
  const metrics = { recordStoreTransactionVerification: jest.fn() };
  const service = new EntitlementService(
    database as unknown as PrismaService,
    new AppleTransactionVerifier(storeConfig()),
    logger as unknown as JsonLoggerService,
    metrics as unknown as MetricsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    transaction.storeProduct.findUnique.mockResolvedValue({
      productType: "NON_CONSUMABLE",
      status: "ACTIVE",
      offer: { grants: [{ entitlementKey: ENTITLEMENT_KEY }] },
    });
    transaction.storeTransaction.findUnique.mockResolvedValue(null);
    transaction.storeTransaction.create.mockResolvedValue({
      id: LEDGER_ROW_ID,
    });
    transaction.storeTransaction.update.mockResolvedValue({
      id: LEDGER_ROW_ID,
    });
    transaction.user.findUnique.mockResolvedValue(null);
    transaction.userEntitlementGrant.upsert.mockResolvedValue({ id: "grant" });
    transaction.userEntitlementGrant.findMany.mockResolvedValue([
      { entitlementKey: ENTITLEMENT_KEY },
    ]);
  });

  describe("submitAppleTransactions", () => {
    it("grants what the server's own mapping says the product is worth", async () => {
      const snapshot = await service.submitAppleTransactions(
        OWNER,
        [purchase({ appAccountToken: OWNER_TOKEN })],
        REQUEST_ID,
      );

      // The product came out of the signed payload and the grant came out of
      // the offer mapping. Nothing in the request said either.
      expect(transaction.storeProduct.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            provider_storeEnvironment_bundleId_productId: {
              provider: "APPLE_APP_STORE",
              storeEnvironment: StoreEnvironment.LOCAL_TEST,
              bundleId: BUNDLE_ID,
              productId: PRODUCT_ID,
            },
          },
        }),
      );
      expect(transaction.storeTransaction.create).toHaveBeenCalledTimes(1);
      expect(
        firstCall<{ create: Record<string, unknown> }>(
          transaction.userEntitlementGrant.upsert,
        ).create,
      ).toMatchObject({
        userId: OWNER,
        entitlementKey: ENTITLEMENT_KEY,
        sourceType: "STORE_TRANSACTION",
        sourceTransactionId: LEDGER_ROW_ID,
        status: "ACTIVE",
      });
      expect(snapshot.entitlementKeys).toEqual([ENTITLEMENT_KEY]);
      expect(snapshot.etag).toBe(entitlementEtag([ENTITLEMENT_KEY]));
    });

    it("records a second delivery of the same purchase as the same row", async () => {
      transaction.storeTransaction.findUnique.mockResolvedValue({
        id: LEDGER_ROW_ID,
        userId: OWNER,
        claimState: "CLAIMED",
      });

      await service.submitAppleTransactions(
        OWNER,
        [purchase({ appAccountToken: OWNER_TOKEN })],
        REQUEST_ID,
      );

      expect(transaction.storeTransaction.create).not.toHaveBeenCalled();
      expect(transaction.storeTransaction.update).toHaveBeenCalledTimes(1);
    });

    it("refuses a purchase a live account is already holding", async () => {
      transaction.storeTransaction.findUnique.mockResolvedValue({
        id: LEDGER_ROW_ID,
        userId: STRANGER,
        claimState: "CLAIMED",
      });
      transaction.user.findUnique.mockResolvedValue({
        id: STRANGER,
        status: UserStatus.ACTIVE,
      });

      const refusal = await refused(
        service.submitAppleTransactions(OWNER, [purchase()], REQUEST_ID),
      );

      expect(refusal).toEqual({
        status: 409,
        code: "PURCHASE_BOUND_TO_ANOTHER_ACCOUNT",
        details: {
          transactionReference: maskTransactionReference(TRANSACTION_ID),
        },
      });
      // Not the account, not its identifier, not a hint of its address.
      expect(JSON.stringify(refusal)).not.toContain(STRANGER);
      expect(transaction.userEntitlementGrant.upsert).not.toHaveBeenCalled();
    });

    it("lets a verified restore take a purchase its owner released", async () => {
      transaction.storeTransaction.findUnique.mockResolvedValue({
        id: LEDGER_ROW_ID,
        userId: null,
        claimState: "RELEASED_BY_ACCOUNT_DELETION",
      });

      await service.submitAppleTransactions(
        OWNER,
        [purchase({ appAccountToken: STRANGER_TOKEN })],
        REQUEST_ID,
      );

      // The token in the payload belongs to the account that is gone; a
      // released purchase is the one state a claim may move from, and the
      // token cannot be what stops it.
      expect(
        firstCall<{ data: Record<string, unknown> }>(
          transaction.storeTransaction.update,
        ).data,
      ).toMatchObject({ userId: OWNER, claimState: "CLAIMED" });
      expect(transaction.userEntitlementGrant.upsert).toHaveBeenCalledTimes(1);
    });

    it("refuses a first claim whose token names another live account", async () => {
      transaction.user.findUnique.mockResolvedValue({
        id: STRANGER,
        status: UserStatus.ACTIVE,
      });

      const refusal = await refused(
        service.submitAppleTransactions(
          OWNER,
          [purchase({ appAccountToken: STRANGER_TOKEN })],
          REQUEST_ID,
        ),
      );

      expect(refusal.code).toBe("PURCHASE_BOUND_TO_ANOTHER_ACCOUNT");
      expect(transaction.storeTransaction.create).not.toHaveBeenCalled();
    });

    it("accepts a first claim whose token names an account that is gone", async () => {
      transaction.user.findUnique.mockResolvedValue({
        id: STRANGER,
        status: UserStatus.DELETED,
      });

      await expect(
        service.submitAppleTransactions(
          OWNER,
          [purchase({ appAccountToken: STRANGER_TOKEN })],
          REQUEST_ID,
        ),
      ).resolves.toMatchObject({ entitlementKeys: [ENTITLEMENT_KEY] });
    });

    it("refuses a product this deployment does not sell", async () => {
      transaction.storeProduct.findUnique.mockResolvedValue(null);

      const refusal = await refused(
        service.submitAppleTransactions(OWNER, [purchase()], REQUEST_ID),
      );

      expect(refusal).toMatchObject({
        status: 422,
        code: "TRANSACTION_VERIFICATION_FAILED",
        details: {
          reason: "UNKNOWN_PRODUCT",
          transactionReference: maskTransactionReference(TRANSACTION_ID),
        },
      });
      expect(transaction.storeTransaction.create).not.toHaveBeenCalled();
      expect(metrics.recordStoreTransactionVerification).toHaveBeenCalledWith(
        "UNKNOWN_PRODUCT",
      );
    });

    it("still honours a purchase whose product was taken off sale", async () => {
      transaction.storeProduct.findUnique.mockResolvedValue({
        productType: "NON_CONSUMABLE",
        status: "RETIRED",
        offer: { grants: [{ entitlementKey: ENTITLEMENT_KEY }] },
      });

      await expect(
        service.submitAppleTransactions(OWNER, [purchase()], REQUEST_ID),
      ).resolves.toMatchObject({ entitlementKeys: [ENTITLEMENT_KEY] });
    });

    it("revokes rather than grants when Apple has refunded the purchase", async () => {
      const revokedAt = new Date("2026-09-03T08:30:00.000Z");

      await service.submitAppleTransactions(
        OWNER,
        [purchase({ revocationDate: revokedAt, revocationReason: 0 })],
        REQUEST_ID,
      );

      expect(transaction.userEntitlementGrant.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: {
            status: "REVOKED",
            revokedAt,
            revocationReason: "REFUNDED_FOR_OTHER_REASON",
          },
        }),
      );
    });

    it("refuses the whole batch when one payload does not verify", async () => {
      const refusal = await refused(
        service.submitAppleTransactions(
          OWNER,
          [purchase(), purchase({ environment: "Production" })],
          REQUEST_ID,
        ),
      );

      expect(refusal).toEqual({
        status: 422,
        code: "TRANSACTION_VERIFICATION_FAILED",
        // No reference: nothing in an unverified payload has been
        // established, so there is nothing worth quoting back.
        details: { reason: "ENVIRONMENT_MISMATCH" },
      });
      expect(database.$transaction).not.toHaveBeenCalled();
    });

    it("asks the client to come back when the store is not configured yet", async () => {
      const unconfiguredStore: AppleStoreConfig = {
        ...storeConfig(),
        bundleId: "",
        configured: false,
      };
      const unconfigured = new EntitlementService(
        database as unknown as PrismaService,
        new AppleTransactionVerifier(unconfiguredStore),
        logger as unknown as JsonLoggerService,
        metrics as unknown as MetricsService,
      );

      const refusal = await refused(
        unconfigured.submitAppleTransactions(OWNER, [purchase()], REQUEST_ID),
      );

      expect(refusal).toMatchObject({
        status: 503,
        code: "STORE_VERIFICATION_UNAVAILABLE",
        details: { reason: "STORE_NOT_CONFIGURED" },
      });
    });

    it("writes no evidence of the purchase into the log", async () => {
      const signedTransaction = purchase({ appAccountToken: OWNER_TOKEN });
      await service.submitAppleTransactions(
        OWNER,
        [signedTransaction],
        REQUEST_ID,
      );

      const written = JSON.stringify(logger.log.mock.calls);
      expect(written).not.toContain(signedTransaction);
      expect(written).not.toContain(OWNER_TOKEN);
      expect(written).not.toContain(TRANSACTION_ID);
      expect(written).toContain(maskTransactionReference(TRANSACTION_ID));
    });
  });

  describe("releaseOnAccountDeletion", () => {
    it("takes the rights and releases the purchase", async () => {
      transaction.userEntitlementGrant.deleteMany.mockResolvedValue({
        count: 2,
      });
      transaction.storeTransaction.updateMany.mockResolvedValue({ count: 1 });

      const released = await service.releaseOnAccountDeletion(
        transaction as never,
        OWNER,
      );

      expect(transaction.userEntitlementGrant.deleteMany).toHaveBeenCalledWith({
        where: { userId: OWNER },
      });
      expect(transaction.storeTransaction.updateMany).toHaveBeenCalledWith({
        where: { userId: OWNER },
        data: {
          userId: null,
          claimState: "RELEASED_BY_ACCOUNT_DELETION",
        },
      });
      expect(released).toEqual({ entitlementGrants: 2, storeTransactions: 1 });
    });
  });

  describe("entitlementEtag", () => {
    it("depends on the rights and on nothing else", () => {
      expect(entitlementEtag(["b", "a"])).toBe(entitlementEtag(["a", "b"]));
      expect(entitlementEtag(["a"])).not.toBe(entitlementEtag(["a", "b"]));
      expect(entitlementEtag([])).toMatch(/^"[0-9a-f]{32}"$/);
    });
  });

  describe("maskTransactionReference", () => {
    it("says enough to find the row and nothing that could be evidence", () => {
      expect(maskTransactionReference("2000000900000001")).toBe("****0001");
    });
  });
});
