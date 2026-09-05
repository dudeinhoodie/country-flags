import {
  AdminRole,
  AdminUserStatus,
  StoreEnvironment,
  StoreProvider,
  StoreSyncRunStatus,
} from "@prisma/client";
import type { AdminUser } from "@prisma/client";

import { PrismaService } from "../../../infrastructure/database/prisma.service";
import { AdminAuditService } from "../../admin-auth/admin-audit.service";
import {
  apiStoreSyncRun,
  apiStoreTransaction,
  maskStoreIdentifier,
} from "./admin-commerce.response";
import { StoreSyncRunService } from "./store-sync-run.service";

const RUN_ID = "70000000-0000-4000-8000-0000000000b1";

const ACTOR: AdminUser = {
  id: "70000000-0000-4000-8000-0000000000aa",
  email: "operator@country-flags.test",
  displayName: "Operator",
  role: AdminRole.ADMIN,
  status: AdminUserStatus.ACTIVE,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
};

function runRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: RUN_ID,
    provider: StoreProvider.APPLE_APP_STORE,
    storeEnvironment: StoreEnvironment.SANDBOX,
    status: StoreSyncRunStatus.QUEUED,
    checkedProductCount: null,
    failureMessage: null,
    requestedByAdminUserId: ACTOR.id,
    startedAt: new Date("2026-09-05T10:00:00Z"),
    finishedAt: null,
    ...overrides,
  };
}

interface FakeClient {
  storeSyncRun: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
  };
}

function serviceUnderTest(): {
  service: StoreSyncRunService;
  client: FakeClient;
  audited: () => string[];
} {
  const actions: string[] = [];
  const client: FakeClient = {
    storeSyncRun: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(() => Promise.resolve(runRow())),
    },
  };
  const database = {
    ...client,
    $transaction: (
      argument: ((tx: unknown) => Promise<unknown>) | Promise<unknown>[],
    ): Promise<unknown> =>
      Array.isArray(argument) ? Promise.all(argument) : argument(client),
  } as unknown as PrismaService;
  const audit = {
    record: (
      _transaction: unknown,
      event: { action: string },
    ): Promise<void> => {
      actions.push(event.action);
      return Promise.resolve();
    },
  } as unknown as AdminAuditService;
  return {
    service: new StoreSyncRunService(database, audit, StoreEnvironment.SANDBOX),
    client,
    audited: (): string[] => actions,
  };
}

describe("StoreSyncRunService", () => {
  it("queues a run for this store and records who asked", async () => {
    const { service, client, audited } = serviceUnderTest();

    const run = await service.start(ACTOR, "request-1");

    expect(run.status).toBe(StoreSyncRunStatus.QUEUED);
    const calls = client.storeSyncRun.create.mock.calls as unknown[][];
    const written = (calls[0]?.[0] ?? {}) as { data: Record<string, unknown> };
    expect(written.data.storeEnvironment).toBe(StoreEnvironment.SANDBOX);
    expect(written.data.requestedByAdminUserId).toBe(ACTOR.id);
    expect(audited()).toEqual(["admin.commerce.store_sync_queued"]);
  });

  /// Two concurrent runs would write the same products' validation state
  /// from two answers, and the later one would not be the newer one.
  it("refuses a second run while one is under way", async () => {
    const { service, client } = serviceUnderTest();
    client.storeSyncRun.findFirst.mockResolvedValue({ id: RUN_ID });

    await expect(service.start(ACTOR, "request-1")).rejects.toMatchObject({
      response: {
        error: {
          code: "STORE_SYNC_RUN_IN_FLIGHT",
          details: { runId: RUN_ID },
        },
      },
    });
    expect(client.storeSyncRun.create).not.toHaveBeenCalled();
  });

  it("answers 404 for a run this deployment never made", async () => {
    const { service } = serviceUnderTest();

    await expect(service.get(RUN_ID)).rejects.toMatchObject({
      response: { error: { code: "RESOURCE_NOT_FOUND" } },
    });
  });
});

describe("what support is shown", () => {
  /// A fixed-length mask: one that grew with the identifier would say how
  /// long the identifier is, and a proportional one would be mostly
  /// readable.
  it("keeps only the tail of a store identifier", () => {
    expect(maskStoreIdentifier("2000000912345678")).toBe("****5678");
    expect(maskStoreIdentifier("2000000900000001")).toBe("****0001");
  });

  it("never returns the signed payload, its hash or the buyer", () => {
    const body = apiStoreTransaction(
      {
        id: "70000000-0000-4000-8000-0000000000c1",
        provider: StoreProvider.APPLE_APP_STORE,
        storeEnvironment: StoreEnvironment.SANDBOX,
        transactionId: "2000000912345678",
        originalTransactionId: "2000000912345678",
        productId: "app.countryflags.deck.european_coats.lifetime.v1",
        storeAccountToken: "70000000-0000-4000-8000-0000000000d1",
        userId: "70000000-0000-4000-8000-0000000000e1",
        ownershipType: "PURCHASED",
        purchasedAt: new Date("2026-09-04T12:20:00Z"),
        revokedAt: null,
        revocationReason: null,
        signedPayloadHash: "a".repeat(64),
        verifiedAt: new Date("2026-09-04T12:20:01Z"),
        claimState: "CLAIMED",
        createdAt: new Date("2026-09-04T12:20:01Z"),
        updatedAt: new Date("2026-09-04T12:20:01Z"),
      },
      ["entitlement.european_coats"],
    );

    expect(body.maskedTransactionId).toBe("****5678");
    const serialized = JSON.stringify(body);
    for (const secret of [
      "2000000912345678",
      "a".repeat(64),
      "70000000-0000-4000-8000-0000000000d1",
      "70000000-0000-4000-8000-0000000000e1",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("shapes a run the way the console watches it", () => {
    expect(
      apiStoreSyncRun({
        id: RUN_ID,
        provider: StoreProvider.APPLE_APP_STORE,
        storeEnvironment: StoreEnvironment.SANDBOX,
        status: StoreSyncRunStatus.SUCCEEDED,
        checkedProductCount: 3,
        failureMessage: null,
        requestedByAdminUserId: ACTOR.id,
        startedAt: new Date("2026-09-05T10:00:00Z"),
        finishedAt: new Date("2026-09-05T10:00:12Z"),
      }),
    ).toEqual({
      id: RUN_ID,
      status: StoreSyncRunStatus.SUCCEEDED,
      startedAt: "2026-09-05T10:00:00.000Z",
      finishedAt: "2026-09-05T10:00:12.000Z",
      checkedProductCount: 3,
      failureMessage: null,
    });
  });
});
