import { StoreEnvironment } from "@prisma/client";

import type { JsonLoggerService } from "../../../common/logging/json-logger.service";
import type { MetricsService } from "../../../common/telemetry/metrics.service";
import type { PrismaService } from "../../../infrastructure/database/prisma.service";
import type { EntitlementService } from "../entitlement.service";
import type { AppleNotificationService } from "./apple-notification.service";
import { AppleNotificationVerifier } from "./apple-notification-verifier";
import { AppleReconciliationService } from "./apple-reconciliation.service";
import type { AppleNotificationHistoryPage } from "./apple-server-api.client";
import type { AppleServerApiClient } from "./apple-server-api.client";
import { AppleStoreConfig } from "./apple-store.config";
import { AppleTransactionVerifier } from "./apple-transaction-verifier";
import {
  localTestSignedNotification,
  localTestSignedTransaction,
} from "./testing/local-store-transaction";

const BUNDLE_ID = "app.countryflags.mobile.local";
const PRODUCT_ID = "app.countryflags.deck.european_coats.lifetime.v1";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function storeConfig(): AppleStoreConfig {
  return {
    storeEnvironment: StoreEnvironment.LOCAL_TEST,
    bundleId: BUNDLE_ID,
    appAppleId: null,
    rootCertificates: [],
    keyId: "KEY",
    issuerId: "ISSUER",
    privateKey: "PRIVATE",
    apiCredentialPresent: true,
    onlineChecks: false,
    localTestAllowed: true,
    configured: true,
  };
}

function notification(uuid: string, transactionId: string): string {
  return localTestSignedNotification({
    notificationUuid: uuid,
    notificationType: "REFUND",
    bundleId: BUNDLE_ID,
    signedTransactionInfo: localTestSignedTransaction({
      transactionId,
      productId: PRODUCT_ID,
      bundleId: BUNDLE_ID,
    }),
  });
}

function page(
  signedPayloads: string[],
  paginationToken: string | null = null,
): AppleNotificationHistoryPage {
  return {
    signedPayloads,
    paginationToken,
    hasMore: paginationToken !== null,
  };
}

describe("AppleReconciliationService", () => {
  const failedNotifications = jest.fn<
    Promise<AppleNotificationHistoryPage>,
    unknown[]
  >();
  const upsert = jest.fn<
    Promise<unknown>,
    [{ update: { lastRevision: string | null; lastSucceededAt?: Date } }]
  >();
  const receive = jest.fn<Promise<unknown>, unknown[]>();
  const config = storeConfig();
  const database = {
    storeReconciliationState: {
      findUnique: jest.fn<Promise<unknown>, unknown[]>(),
      upsert,
    },
  };
  const api = {
    configured: true,
    failedNotifications,
    transactionInfo: jest.fn(),
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const metrics = {
    recordStoreReconciliation: jest.fn(),
    recordStoreNotification: jest.fn(),
  };
  const service = new AppleReconciliationService(
    database as unknown as PrismaService,
    api as unknown as AppleServerApiClient,
    new AppleNotificationVerifier(config, new AppleTransactionVerifier(config)),
    new AppleTransactionVerifier(config),
    { receive } as unknown as AppleNotificationService,
    { applyFromNotification: jest.fn() } as unknown as EntitlementService,
    logger as unknown as JsonLoggerService,
    metrics as unknown as MetricsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    database.storeReconciliationState.findUnique.mockResolvedValue(null);
    upsert.mockResolvedValue({});
    receive.mockResolvedValue("processed");
  });

  it("replays what Apple could not deliver, and says what it found", async () => {
    failedNotifications.mockResolvedValue(
      page([
        notification(
          "c1000000-0000-4000-8000-000000000001",
          "2000000900000001",
        ),
        notification(
          "c1000000-0000-4000-8000-000000000002",
          "2000000900000002",
        ),
      ]),
    );

    const outcome = await service.run(REQUEST_ID);

    expect(outcome).toEqual({
      recovered: 2,
      processed: 2,
      quarantined: 0,
      duplicates: 0,
      pages: 1,
    });
    expect(receive).toHaveBeenCalledTimes(2);
    expect(metrics.recordStoreReconciliation).toHaveBeenCalledWith(
      "succeeded",
      expect.any(Number),
    );
  });

  // A page nine that dies must resume on page nine, not pay for the first
  // eight again.
  it("keeps its place as it pages", async () => {
    failedNotifications
      .mockResolvedValueOnce(
        page(
          [
            notification(
              "c1000000-0000-4000-8000-000000000003",
              "2000000900000003",
            ),
          ],
          "PAGE-2",
        ),
      )
      .mockResolvedValueOnce(
        page([
          notification(
            "c1000000-0000-4000-8000-000000000004",
            "2000000900000004",
          ),
        ]),
      );

    const outcome = await service.run(REQUEST_ID);

    expect(outcome.pages).toBe(2);
    expect(upsert.mock.calls[0]?.[0].update.lastRevision).toBe("PAGE-2");
    // A finished sweep forgets the page and starts the next one from now.
    const last = upsert.mock.calls.at(-1)?.[0].update;
    expect(last?.lastRevision).toBeNull();
    expect(last?.lastSucceededAt).toBeInstanceOf(Date);
  });

  it("does not stop the sweep for one payload it cannot read", async () => {
    failedNotifications.mockResolvedValue(
      page([
        "not.a.jws",
        notification(
          "c1000000-0000-4000-8000-000000000005",
          "2000000900000005",
        ),
      ]),
    );

    const outcome = await service.run(REQUEST_ID);

    expect(outcome).toMatchObject({
      recovered: 2,
      processed: 1,
      quarantined: 1,
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("records the failure and keeps the cursor when Apple refuses", async () => {
    failedNotifications.mockRejectedValue(new Error("429 Too Many Requests"));

    await expect(service.run(REQUEST_ID)).rejects.toThrow("429");

    expect(metrics.recordStoreReconciliation).toHaveBeenCalledWith(
      "failed",
      expect.any(Number),
    );
    expect(
      upsert.mock.calls.at(-1)?.[0].update.lastSucceededAt,
    ).toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it("counts a redelivery as a duplicate rather than as work", async () => {
    receive.mockResolvedValue("duplicate");
    failedNotifications.mockResolvedValue(
      page([
        notification(
          "c1000000-0000-4000-8000-000000000006",
          "2000000900000006",
        ),
      ]),
    );

    const outcome = await service.run(REQUEST_ID);

    expect(outcome).toMatchObject({ processed: 0, duplicates: 1 });
  });
});
