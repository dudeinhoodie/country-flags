import { StoreEnvironment, StoreNotificationStatus } from "@prisma/client";

import type { JsonLoggerService } from "../../../common/logging/json-logger.service";
import type { MetricsService } from "../../../common/telemetry/metrics.service";
import type { PrismaService } from "../../../infrastructure/database/prisma.service";
import type { EntitlementService } from "../entitlement.service";
import { AppleNotificationService } from "./apple-notification.service";
import { AppleNotificationVerifier } from "./apple-notification-verifier";
import type { VerifiedAppleTransaction } from "./apple-transaction-verifier";
import { AppleStoreConfig } from "./apple-store.config";
import { AppleTransactionVerifier } from "./apple-transaction-verifier";
import {
  localTestSignedNotification,
  localTestSignedTransaction,
} from "./testing/local-store-transaction";

const BUNDLE_ID = "app.countryflags.mobile.local";
const PRODUCT_ID = "app.countryflags.deck.european_coats.lifetime.v1";
const TRANSACTION_ID = "2000000900000001";
const NOTIFICATION_UUID = "c1000000-0000-4000-8000-000000000001";
const ROW_ID = "d1000000-0000-4000-8000-000000000001";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function storeConfig(): AppleStoreConfig {
  return {
    storeEnvironment: StoreEnvironment.LOCAL_TEST,
    bundleId: BUNDLE_ID,
    appAppleId: null,
    rootCertificates: [],
    keyId: "",
    issuerId: "",
    privateKey: "",
    apiCredentialPresent: false,
    onlineChecks: false,
    localTestAllowed: true,
    configured: true,
  };
}

function signedNotification(
  overrides: Partial<Parameters<typeof localTestSignedNotification>[0]> = {},
  transaction: Partial<Parameters<typeof localTestSignedTransaction>[0]> = {},
): string {
  return localTestSignedNotification({
    notificationUuid: NOTIFICATION_UUID,
    notificationType: "REFUND",
    bundleId: BUNDLE_ID,
    signedTransactionInfo: localTestSignedTransaction({
      transactionId: TRANSACTION_ID,
      productId: PRODUCT_ID,
      bundleId: BUNDLE_ID,
      ...transaction,
    }),
    ...overrides,
  });
}

describe("AppleNotificationService", () => {
  // Typed where the test reads a call back: an untyped jest mock hands out
  // `any`, and the rule against that is the one keeping these assertions
  // honest.
  const create = jest.fn<
    Promise<{ id: string }>,
    [{ data: Record<string, unknown> }]
  >();
  const applyFromNotification = jest.fn<
    Promise<string>,
    [VerifiedAppleTransaction, string]
  >();
  const update = jest.fn<
    Promise<{ id: string }>,
    [{ data: { status: StoreNotificationStatus; error: string | null } }]
  >();
  const database = {
    storeNotification: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create,
      update,
    },
  };
  const entitlements = { applyFromNotification };
  const logger = { log: jest.fn(), warn: jest.fn() };
  const metrics = { recordStoreNotification: jest.fn() };
  const config = storeConfig();
  const verifier = new AppleNotificationVerifier(
    config,
    new AppleTransactionVerifier(config),
  );
  const service = new AppleNotificationService(
    database as unknown as PrismaService,
    verifier,
    entitlements as unknown as EntitlementService,
    logger as unknown as JsonLoggerService,
    metrics as unknown as MetricsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    database.storeNotification.findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: ROW_ID });
    update.mockResolvedValue({ id: ROW_ID });
    applyFromNotification.mockResolvedValue("applied");
  });

  it("acts on a refund and records it as processed", async () => {
    const notification = await verifier.verify(signedNotification());

    const outcome = await service.receive(notification, REQUEST_ID);

    expect(outcome).toBe("processed");
    expect(entitlements.applyFromNotification).toHaveBeenCalledTimes(1);
    const applied: unknown =
      entitlements.applyFromNotification.mock.calls[0]?.[0];
    expect((applied as { transactionId: string }).transactionId).toBe(
      TRANSACTION_ID,
    );
    expect(update.mock.calls[0]?.[0].data.status).toBe(
      StoreNotificationStatus.PROCESSED,
    );
  });

  // Apple retries until it is acknowledged, and a retry of something already
  // settled must change nothing at all.
  it("does nothing the second time the same notification arrives", async () => {
    database.storeNotification.findUnique.mockResolvedValue({
      id: ROW_ID,
      status: StoreNotificationStatus.PROCESSED,
    });
    const notification = await verifier.verify(signedNotification());

    const outcome = await service.receive(notification, REQUEST_ID);

    expect(outcome).toBe("duplicate");
    expect(entitlements.applyFromNotification).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(metrics.recordStoreNotification).toHaveBeenCalledWith("duplicate");
  });

  it("answers a test notification without touching anybody's rights", async () => {
    const notification = await verifier.verify(
      localTestSignedNotification({
        notificationUuid: NOTIFICATION_UUID,
        notificationType: "TEST",
        bundleId: BUNDLE_ID,
      }),
    );

    const outcome = await service.receive(notification, REQUEST_ID);

    expect(outcome).toBe("processed");
    expect(entitlements.applyFromNotification).not.toHaveBeenCalled();
  });

  it("quarantines a product this deployment does not sell", async () => {
    applyFromNotification.mockResolvedValue("UNKNOWN_PRODUCT");
    const notification = await verifier.verify(signedNotification());

    const outcome = await service.receive(notification, REQUEST_ID);

    expect(outcome).toEqual({ quarantined: "UNKNOWN_PRODUCT" });
    expect(update.mock.calls[0]?.[0].data).toEqual({
      status: StoreNotificationStatus.QUARANTINED,
      error: "UNKNOWN_PRODUCT",
      processedAt: expect.any(Date) as Date,
    });
    expect(logger.warn).toHaveBeenCalled();
    expect(metrics.recordStoreNotification).toHaveBeenCalledWith("quarantined");
  });

  it("quarantines a notification whose purchase nobody here holds", async () => {
    applyFromNotification.mockResolvedValue("UNKNOWN_ACCOUNT");
    const notification = await verifier.verify(signedNotification());

    expect(await service.receive(notification, REQUEST_ID)).toEqual({
      quarantined: "UNKNOWN_ACCOUNT",
    });
  });

  // A Family Sharing copy verifies as a notification and refuses as a
  // purchase: the delivery was Apple's, the thing inside it is not something
  // this version grants.
  it("quarantines a notification carrying a purchase it will not accept", async () => {
    const notification = await verifier.verify(
      signedNotification({}, { inAppOwnershipType: "FAMILY_SHARED" }),
    );

    expect(notification.transaction).toBeNull();
    expect(notification.transactionRefusal).toBe("OWNERSHIP_TYPE_UNSUPPORTED");
    expect(await service.receive(notification, REQUEST_ID)).toEqual({
      quarantined: "TRANSACTION_REFUSED",
    });
    expect(entitlements.applyFromNotification).not.toHaveBeenCalled();
  });

  it("records a type this product does not sell without acting on it", async () => {
    const notification = await verifier.verify(
      signedNotification({ notificationType: "SUBSCRIBED" }),
    );

    expect(await service.receive(notification, REQUEST_ID)).toEqual({
      quarantined: "UNHANDLED_TYPE",
    });
    expect(entitlements.applyFromNotification).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });

  it("keeps no payload beyond its hash", async () => {
    const signed = signedNotification();
    const notification = await verifier.verify(signed);

    await service.receive(notification, REQUEST_ID);

    const created: unknown =
      database.storeNotification.create.mock.calls[0]?.[0];
    const { data } = created as { data: Record<string, unknown> };
    expect(JSON.stringify(data)).not.toContain(signed);
    expect(data.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
