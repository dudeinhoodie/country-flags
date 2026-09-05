import {
  AdminRole,
  AdminUserStatus,
  CommerceOfferKind,
  CommerceOfferStatus,
  EntitlementStatus,
  StoreEnvironment,
  StoreProductStatus,
  StoreProductType,
  StoreProvider,
} from "@prisma/client";
import type { AdminUser } from "@prisma/client";

import { PrismaService } from "../../../infrastructure/database/prisma.service";
import { AdminAuditService } from "../../admin-auth/admin-audit.service";
import { AdminCommerceService } from "./admin-commerce.service";

const OFFER_ID = "70000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "70000000-0000-4000-8000-000000000002";

function actorWith(role: AdminRole): AdminUser {
  return {
    id: "70000000-0000-4000-8000-0000000000aa",
    email: "operator@country-flags.test",
    displayName: "Operator",
    role,
    status: AdminUserStatus.ACTIVE,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
  };
}

interface OfferOverrides {
  status?: CommerceOfferStatus;
  grants?: string[];
  products?: Record<string, unknown>[];
}

function offerRow(overrides: OfferOverrides = {}): Record<string, unknown> {
  return {
    id: OFFER_ID,
    code: "EUROPEAN_COATS_LIFETIME",
    kind: CommerceOfferKind.ONE_TIME,
    status: overrides.status ?? CommerceOfferStatus.DRAFT,
    sortOrder: null,
    notes: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    grants: (overrides.grants ?? ["entitlement.european_coats"]).map((key) => ({
      offerId: OFFER_ID,
      entitlementKey: key,
    })),
    localizations: [],
    products: overrides.products ?? [],
  };
}

function productRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: PRODUCT_ID,
    offerId: OFFER_ID,
    provider: StoreProvider.APPLE_APP_STORE,
    storeEnvironment: StoreEnvironment.SANDBOX,
    bundleId: "app.countryflags.mobile.dev",
    productId: "app.countryflags.deck.european_coats.lifetime.v1",
    productType: StoreProductType.NON_CONSUMABLE,
    status: StoreProductStatus.VALIDATED,
    storeStatus: null,
    lastValidatedAt: null,
    validationError: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

interface FakeClient {
  commerceOffer: {
    count: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  storeProduct: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  storeTransaction: { findFirst: jest.Mock };
  entitlementDefinition: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
  };
  storeReconciliationState: { findMany: jest.Mock };
  deck: { findMany: jest.Mock };
}

/** The first argument the mock was called with, as the shape under test. */
function firstArgument<T>(mock: jest.Mock): T {
  const calls = mock.mock.calls as unknown[][];
  const call = calls[0];
  if (call === undefined) {
    throw new Error("The mock was never called");
  }
  return call[0] as T;
}

function serviceOn(
  storeEnvironment: StoreEnvironment = StoreEnvironment.SANDBOX,
): {
  service: AdminCommerceService;
  client: FakeClient;
  audited: () => string[];
} {
  const actions: string[] = [];
  const client: FakeClient = {
    commerceOffer: {
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(() => Promise.resolve(offerRow())),
      update: jest.fn().mockImplementation(() => Promise.resolve(offerRow())),
    },
    storeProduct: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(() => Promise.resolve(productRow())),
      update: jest.fn().mockImplementation(() => Promise.resolve(productRow())),
    },
    storeTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
    entitlementDefinition: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({
        key: "entitlement.european_coats",
        status: EntitlementStatus.ACTIVE,
        description: null,
      }),
    },
    storeReconciliationState: { findMany: jest.fn().mockResolvedValue([]) },
    deck: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const database = {
    ...client,
    // The service reads through the batch form and writes through the
    // callback form, so the fake has to answer both.
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
    service: new AdminCommerceService(database, audit, storeEnvironment),
    client,
    audited: (): string[] => actions,
  };
}

describe("AdminCommerceService", () => {
  describe("mapping a store product", () => {
    /// The mistake the whole section exists to prevent. A Sandbox product
    /// recorded against production sells nothing and verifies nothing, and
    /// the operator would only find out from a customer.
    it("refuses a product from a store this deployment does not talk to", async () => {
      const { service, client } = serviceOn(StoreEnvironment.PRODUCTION);

      await expect(
        service.createProduct(
          actorWith(AdminRole.PUBLISHER),
          OFFER_ID,
          {
            provider: StoreProvider.APPLE_APP_STORE,
            storeEnvironment: StoreEnvironment.SANDBOX,
            bundleId: "app.countryflags.mobile.dev",
            productId: "app.countryflags.deck.european_coats.lifetime.v1",
            productType: StoreProductType.NON_CONSUMABLE,
          },
          "request-1",
        ),
      ).rejects.toMatchObject({
        response: {
          error: {
            code: "STORE_ENVIRONMENT_MISMATCH",
            details: { storeEnvironment: StoreEnvironment.PRODUCTION },
          },
        },
      });
      // Refused before anything was looked up, let alone written.
      expect(client.storeProduct.create).not.toHaveBeenCalled();
    });

    it("refuses a product id already mapped in this store", async () => {
      const { service, client } = serviceOn();
      client.commerceOffer.findUnique.mockResolvedValue({
        id: OFFER_ID,
        code: "EUROPEAN_COATS_LIFETIME",
        status: CommerceOfferStatus.DRAFT,
      });
      client.storeProduct.findFirst.mockResolvedValue({
        id: PRODUCT_ID,
        offerId: "70000000-0000-4000-8000-00000000000f",
      });

      await expect(
        service.createProduct(
          actorWith(AdminRole.PUBLISHER),
          OFFER_ID,
          {
            provider: StoreProvider.APPLE_APP_STORE,
            storeEnvironment: StoreEnvironment.SANDBOX,
            bundleId: "app.countryflags.mobile.dev",
            productId: "app.countryflags.deck.european_coats.lifetime.v1",
            productType: StoreProductType.NON_CONSUMABLE,
          },
          "request-1",
        ),
      ).rejects.toMatchObject({
        response: { error: { code: "STORE_PRODUCT_ALREADY_MAPPED" } },
      });
    });

    it("records the mapping it made", async () => {
      const { service, client, audited } = serviceOn();
      client.commerceOffer.findUnique.mockResolvedValue({
        id: OFFER_ID,
        code: "EUROPEAN_COATS_LIFETIME",
        status: CommerceOfferStatus.DRAFT,
      });

      await service.createProduct(
        actorWith(AdminRole.PUBLISHER),
        OFFER_ID,
        {
          provider: StoreProvider.APPLE_APP_STORE,
          storeEnvironment: StoreEnvironment.SANDBOX,
          bundleId: "app.countryflags.mobile.dev",
          productId: "app.countryflags.deck.european_coats.lifetime.v1",
          productType: StoreProductType.NON_CONSUMABLE,
        },
        "request-1",
      );

      expect(audited()).toEqual(["admin.commerce.store_product_mapped"]);
      const written = firstArgument<{ data: Record<string, unknown> }>(
        client.storeProduct.create,
      );
      // Nothing that could be mistaken for what the deck costs.
      expect(Object.keys(written.data)).not.toContain("price");
    });
  });

  describe("putting an offer on sale", () => {
    it("refuses an editor who tries to activate", async () => {
      const { service, client } = serviceOn();
      client.commerceOffer.findUnique.mockResolvedValue(offerRow());

      await expect(
        service.updateOffer(
          actorWith(AdminRole.EDITOR),
          OFFER_ID,
          { status: CommerceOfferStatus.ACTIVE },
          "request-1",
        ),
      ).rejects.toMatchObject({
        response: {
          error: {
            code: "ADMIN_ROLE_FORBIDDEN",
            details: { requiredRole: AdminRole.PUBLISHER },
          },
        },
      });
    });

    /// An active offer with nothing sellable behind it is a paywall with no
    /// way through, and the customer is the one who discovers that.
    it("refuses activation without a validated product in this store", async () => {
      const { service, client } = serviceOn();
      client.commerceOffer.findUnique.mockResolvedValue(offerRow());
      client.storeProduct.findFirst.mockResolvedValue(null);

      await expect(
        service.updateOffer(
          actorWith(AdminRole.PUBLISHER),
          OFFER_ID,
          { status: CommerceOfferStatus.ACTIVE },
          "request-1",
        ),
      ).rejects.toMatchObject({
        response: {
          error: {
            code: "STORE_PRODUCT_NOT_VALIDATED",
            details: { storeEnvironment: StoreEnvironment.SANDBOX },
          },
        },
      });
    });

    it("refuses to take a retired offer back on sale", async () => {
      const { service, client } = serviceOn();
      client.commerceOffer.findUnique.mockResolvedValue(
        offerRow({ status: CommerceOfferStatus.RETIRED }),
      );

      await expect(
        service.updateOffer(
          actorWith(AdminRole.PUBLISHER),
          OFFER_ID,
          { status: CommerceOfferStatus.ACTIVE },
          "request-1",
        ),
      ).rejects.toMatchObject({
        response: { error: { code: "COMMERCE_OFFER_TRANSITION_INVALID" } },
      });
    });

    it("activates with a validated product and records who did it", async () => {
      const { service, client, audited } = serviceOn();
      client.commerceOffer.findUnique.mockResolvedValue(offerRow());
      client.storeProduct.findFirst.mockResolvedValue({ id: PRODUCT_ID });
      client.commerceOffer.update.mockResolvedValue(
        offerRow({ status: CommerceOfferStatus.ACTIVE }),
      );

      const updated = await service.updateOffer(
        actorWith(AdminRole.PUBLISHER),
        OFFER_ID,
        { status: CommerceOfferStatus.ACTIVE },
        "request-1",
      );

      expect(updated.status).toBe(CommerceOfferStatus.ACTIVE);
      expect(audited()).toEqual(["admin.commerce.offer_status_changed"]);
    });
  });

  describe("what an offer grants", () => {
    /// A purchase bought a set of rights. Taking one away makes what
    /// somebody paid for quietly smaller, and there is no way to tell that
    /// customer apart from the next one.
    it("refuses to shrink the grants of an offer that has been on sale", async () => {
      const { service, client } = serviceOn();
      client.commerceOffer.findUnique.mockResolvedValue(
        offerRow({
          status: CommerceOfferStatus.ACTIVE,
          grants: ["entitlement.european_coats", "entitlement.african_flags"],
          products: [productRow()],
        }),
      );
      client.entitlementDefinition.findMany.mockResolvedValue([
        { key: "entitlement.european_coats" },
      ]);

      await expect(
        service.updateOffer(
          actorWith(AdminRole.PUBLISHER),
          OFFER_ID,
          { grants: ["entitlement.european_coats"] },
          "request-1",
        ),
      ).rejects.toMatchObject({
        response: {
          error: {
            code: "COMMERCE_OFFER_GRANTS_SHRUNK",
            details: { removed: ["entitlement.african_flags"] },
          },
        },
      });
    });

    it("lets a draft offer be reshaped freely", async () => {
      const { service, client } = serviceOn();
      client.commerceOffer.findUnique.mockResolvedValue(
        offerRow({
          grants: ["entitlement.european_coats", "entitlement.african_flags"],
        }),
      );
      client.entitlementDefinition.findMany.mockResolvedValue([
        { key: "entitlement.european_coats" },
      ]);

      await service.updateOffer(
        actorWith(AdminRole.EDITOR),
        OFFER_ID,
        { grants: ["entitlement.european_coats"] },
        "request-1",
      );

      const written = firstArgument<{
        data: { grants: { deleteMany: { entitlementKey: { in: string[] } } } };
      }>(client.commerceOffer.update);
      expect(written.data.grants.deleteMany.entitlementKey.in).toEqual([
        "entitlement.african_flags",
      ]);
    });

    it("refuses an entitlement key nothing declares", async () => {
      const { service, client } = serviceOn();
      client.commerceOffer.findUnique.mockResolvedValue(offerRow());
      client.entitlementDefinition.findMany.mockResolvedValue([]);

      await expect(
        service.updateOffer(
          actorWith(AdminRole.EDITOR),
          OFFER_ID,
          { grants: ["entitlement.nothing_declares_this"] },
          "request-1",
        ),
      ).rejects.toMatchObject({
        response: { error: { code: "ENTITLEMENT_NOT_FOUND" } },
      });
    });
  });

  describe("declaring an entitlement", () => {
    it("refuses a key that already names a right", async () => {
      const { service, client } = serviceOn();
      client.entitlementDefinition.findUnique.mockResolvedValue({
        key: "entitlement.european_coats",
      });

      await expect(
        service.createEntitlement(
          actorWith(AdminRole.PUBLISHER),
          { key: "entitlement.european_coats" },
          "request-1",
        ),
      ).rejects.toMatchObject({
        response: { error: { code: "ENTITLEMENT_ALREADY_EXISTS" } },
      });
    });

    it("records the declaration", async () => {
      const { service, audited } = serviceOn();

      await service.createEntitlement(
        actorWith(AdminRole.PUBLISHER),
        { key: "entitlement.european_coats" },
        "request-1",
      );

      expect(audited()).toEqual(["admin.commerce.entitlement_created"]);
    });
  });

  describe("status", () => {
    it("names the store this deployment talks to", async () => {
      const { service } = serviceOn(StoreEnvironment.PRODUCTION);

      const status = await service.status();

      expect(status.storeEnvironment).toBe(StoreEnvironment.PRODUCTION);
      expect(status).not.toHaveProperty("price");
    });

    it("reports the newest successful reconciliation and any standing error", async () => {
      const { service, client } = serviceOn();
      client.storeReconciliationState.findMany.mockResolvedValue([
        {
          lastSucceededAt: new Date("2026-09-04T12:20:00Z"),
          lastError: "The store answered 503",
          updatedAt: new Date("2026-09-04T12:25:00Z"),
        },
        {
          lastSucceededAt: new Date("2026-09-05T09:00:00Z"),
          lastError: null,
          updatedAt: new Date("2026-09-05T09:00:00Z"),
        },
      ]);

      const status = await service.status();

      expect(status.lastReconciliationAt).toBe("2026-09-05T09:00:00.000Z");
      expect(status.lastReconciliationError).toBe("The store answered 503");
    });
  });

  describe("entitlements and the decks behind them", () => {
    it("names each deck once, however many releases published it", async () => {
      const { service, client } = serviceOn();
      client.entitlementDefinition.findMany.mockResolvedValue([
        {
          key: "entitlement.european_coats",
          status: EntitlementStatus.ACTIVE,
          description: null,
        },
      ]);
      client.deck.findMany.mockResolvedValue([
        {
          code: "EUROPEAN_COATS",
          requiredEntitlementKey: "entitlement.european_coats",
        },
        {
          code: "EUROPEAN_COATS",
          requiredEntitlementKey: "entitlement.european_coats",
        },
      ]);

      const { deckCodesByKey } = await service.listEntitlements();

      expect(deckCodesByKey.get("entitlement.european_coats")).toEqual([
        "EUROPEAN_COATS",
      ]);
    });
  });
});
