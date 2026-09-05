import { HttpStatus, Injectable } from "@nestjs/common";
import {
  AdminRole,
  CommerceOfferStatus,
  DeckStatus,
  EntitlementStatus,
  StoreProductStatus,
} from "@prisma/client";
import type {
  AdminUser,
  Prisma,
  StoreEnvironment,
  StoreProduct,
} from "@prisma/client";

import { ApiException } from "../../../common/http/api.exception";
import { PrismaService } from "../../../infrastructure/database/prisma.service";
import { AdminAuditService } from "../../admin-auth/admin-audit.service";
import { roleSatisfies } from "../../admin-auth/admin-roles";
import type {
  EntitlementCreateInput,
  OfferCreateInput,
  OfferUpdateInput,
  StoreProductCreateInput,
  StoreProductUpdateInput,
} from "./admin-commerce.request";
import type { OfferWithRelations } from "./admin-commerce.response";

const OFFER_RELATIONS = {
  grants: true,
  localizations: true,
  products: true,
} as const;

/** The lifecycle an offer may walk, and no other step. */
const OFFER_TRANSITIONS: Record<CommerceOfferStatus, CommerceOfferStatus[]> = {
  [CommerceOfferStatus.DRAFT]: [
    CommerceOfferStatus.ACTIVE,
    CommerceOfferStatus.RETIRED,
  ],
  // Back to draft is the step that is missing on purpose: an offer that has
  // been on sale is a promise somebody may have bought, and a draft is a
  // thing nobody has.
  [CommerceOfferStatus.ACTIVE]: [CommerceOfferStatus.RETIRED],
  [CommerceOfferStatus.RETIRED]: [],
};

const SELLABLE_PRODUCT_STATUSES = [
  StoreProductStatus.VALIDATED,
  StoreProductStatus.ACTIVE,
];

function notFound(): never {
  throw new ApiException(
    HttpStatus.NOT_FOUND,
    "RESOURCE_NOT_FOUND",
    "The requested resource was not found",
  );
}

function forbidden(required: AdminRole, reason: string): never {
  throw new ApiException(HttpStatus.FORBIDDEN, "ADMIN_ROLE_FORBIDDEN", reason, {
    requiredRole: required,
  });
}

/**
 * The commerce mapping, as the console is allowed to change it.
 *
 * Everything here records what our side of a purchase means: which right an
 * offer grants, and which store listing sells it. Nothing here creates an
 * in-app purchase, changes a price or calls App Store Connect — that key
 * belongs to a job, not to a browser session (17-paid-decks-storekit §12.4).
 *
 * Two rules are enforced here rather than in the console, because a hidden
 * button is not access control: the store environment a mapping names must
 * be the one this deployment talks to, and the grants of an offer that has
 * been on sale may grow but never shrink.
 */
@Injectable()
export class AdminCommerceService {
  constructor(
    private readonly database: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly storeEnvironment: StoreEnvironment,
  ) {}

  /** What an operator checks before believing a storefront works. */
  async status(): Promise<Record<string, unknown>> {
    const [activeOfferCount, offersWithoutValidatedProduct, reconciliation] =
      await this.database.$transaction([
        this.database.commerceOffer.count({
          where: { status: CommerceOfferStatus.ACTIVE },
        }),
        // An active offer with nothing sellable behind it in this store is a
        // paid deck that cannot be bought, and the count is what stops that
        // from being discovered by a customer.
        this.database.commerceOffer.count({
          where: {
            status: CommerceOfferStatus.ACTIVE,
            products: {
              none: {
                storeEnvironment: this.storeEnvironment,
                status: { in: SELLABLE_PRODUCT_STATUSES },
              },
            },
          },
        }),
        this.database.storeReconciliationState.findMany({
          where: { storeEnvironment: this.storeEnvironment },
          select: { lastSucceededAt: true, lastError: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
        }),
      ]);

    let lastReconciliationAt: Date | null = null;
    for (const scope of reconciliation) {
      if (
        scope.lastSucceededAt !== null &&
        (lastReconciliationAt === null ||
          scope.lastSucceededAt > lastReconciliationAt)
      ) {
        lastReconciliationAt = scope.lastSucceededAt;
      }
    }
    const failing = reconciliation.find((scope) => scope.lastError !== null);

    return {
      storeEnvironment: this.storeEnvironment,
      activeOfferCount,
      offersWithoutValidatedProduct,
      lastReconciliationAt: lastReconciliationAt?.toISOString() ?? null,
      lastReconciliationError: failing?.lastError ?? null,
    };
  }

  async listEntitlements(): Promise<{
    entitlements: {
      key: string;
      status: EntitlementStatus;
      description: string | null;
    }[];
    deckCodesByKey: Map<string, string[]>;
  }> {
    const entitlements = await this.database.entitlementDefinition.findMany({
      orderBy: { key: "asc" },
      select: { key: true, status: true, description: true },
    });
    const decks = await this.database.deck.findMany({
      where: {
        status: DeckStatus.PUBLISHED,
        requiredEntitlementKey: { not: null },
      },
      select: { code: true, requiredEntitlementKey: true },
    });

    const deckCodesByKey = new Map<string, string[]>();
    for (const deck of decks) {
      const key = deck.requiredEntitlementKey;
      if (key === null) {
        continue;
      }
      const codes = deckCodesByKey.get(key) ?? [];
      // The same deck code appears once per content release; the console
      // wants the decks this key opens, not how many times it was published.
      if (!codes.includes(deck.code)) {
        codes.push(deck.code);
      }
      deckCodesByKey.set(key, codes);
    }
    for (const codes of deckCodesByKey.values()) {
      codes.sort();
    }
    return { entitlements, deckCodesByKey };
  }

  async createEntitlement(
    actor: AdminUser,
    input: EntitlementCreateInput,
    requestId: string,
  ): Promise<{
    key: string;
    status: EntitlementStatus;
    description: string | null;
  }> {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.entitlementDefinition.findUnique({
        where: { key: input.key },
        select: { key: true },
      });
      if (existing !== null) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "ENTITLEMENT_ALREADY_EXISTS",
          `The entitlement ${input.key} already exists; a key is never reused for a different right`,
        );
      }
      const created = await transaction.entitlementDefinition.create({
        data: {
          key: input.key,
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
        },
        select: { key: true, status: true, description: true },
      });
      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action: "admin.commerce.entitlement_created",
        targetType: "entitlement_definition",
        targetId: created.key,
        requestId,
        metadata: { key: created.key },
      });
      return created;
    });
  }

  async listOffers(): Promise<OfferWithRelations[]> {
    return this.database.commerceOffer.findMany({
      include: OFFER_RELATIONS,
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });
  }

  async getOffer(offerId: string): Promise<OfferWithRelations> {
    const offer = await this.database.commerceOffer.findUnique({
      where: { id: offerId },
      include: OFFER_RELATIONS,
    });
    if (offer === null) {
      notFound();
    }
    return offer;
  }

  async createOffer(
    actor: AdminUser,
    input: OfferCreateInput,
    requestId: string,
  ): Promise<OfferWithRelations> {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.commerceOffer.findUnique({
        where: { code: input.code },
        select: { id: true },
      });
      if (existing !== null) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "COMMERCE_OFFER_CODE_TAKEN",
          `An offer with the code ${input.code} already exists`,
        );
      }
      await this.assertEntitlementsExist(transaction, input.grants);

      const created = await transaction.commerceOffer.create({
        data: {
          code: input.code,
          kind: input.kind,
          ...(input.sortOrder === undefined
            ? {}
            : { sortOrder: input.sortOrder }),
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          grants: {
            create: input.grants.map((entitlementKey) => ({ entitlementKey })),
          },
          ...(input.localizations === undefined
            ? {}
            : {
                localizations: {
                  create: Object.entries(input.localizations).map(
                    ([locale, text]) => ({
                      locale,
                      title: text.name,
                      description: text.description,
                    }),
                  ),
                },
              }),
        },
        include: OFFER_RELATIONS,
      });
      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action: "admin.commerce.offer_created",
        targetType: "commerce_offer",
        targetId: created.id,
        requestId,
        metadata: { code: created.code, grants: input.grants },
      });
      return created;
    });
  }

  async updateOffer(
    actor: AdminUser,
    offerId: string,
    input: OfferUpdateInput,
    requestId: string,
  ): Promise<OfferWithRelations> {
    return this.database.$transaction(async (transaction) => {
      const offer = await transaction.commerceOffer.findUnique({
        where: { id: offerId },
        include: OFFER_RELATIONS,
      });
      if (offer === null) {
        notFound();
      }

      const nextStatus = input.status;
      if (nextStatus !== undefined && nextStatus !== offer.status) {
        // Putting something on sale and taking it off sale are publisher
        // acts; the wording of the offer is not.
        if (!roleSatisfies(actor.role, AdminRole.PUBLISHER)) {
          forbidden(
            AdminRole.PUBLISHER,
            "Activating or retiring an offer requires the PUBLISHER role",
          );
        }
        if (!OFFER_TRANSITIONS[offer.status].includes(nextStatus)) {
          throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            "COMMERCE_OFFER_TRANSITION_INVALID",
            `An offer cannot move from ${offer.status} to ${nextStatus}`,
          );
        }
        if (nextStatus === CommerceOfferStatus.ACTIVE) {
          await this.assertSellableHere(transaction, offerId, offer.code);
        }
      }

      const removedGrants =
        input.grants === undefined
          ? []
          : await this.grantsToRemove(transaction, offer, input.grants, actor);

      const updated = await transaction.commerceOffer.update({
        where: { id: offerId },
        data: {
          ...(nextStatus === undefined ? {} : { status: nextStatus }),
          ...(input.sortOrder === undefined
            ? {}
            : { sortOrder: input.sortOrder }),
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          ...(input.grants === undefined
            ? {}
            : {
                grants: {
                  // Only the removals the rules above allowed — a draft may
                  // still be reshaped freely, and nothing else ever loses a
                  // grant.
                  deleteMany: { entitlementKey: { in: removedGrants } },
                  createMany: {
                    data: input.grants.map((entitlementKey) => ({
                      entitlementKey,
                    })),
                    skipDuplicates: true,
                  },
                },
              }),
          ...(input.localizations === undefined
            ? {}
            : {
                localizations: {
                  deleteMany: {},
                  create: Object.entries(input.localizations).map(
                    ([locale, text]) => ({
                      locale,
                      title: text.name,
                      description: text.description,
                    }),
                  ),
                },
              }),
        },
        include: OFFER_RELATIONS,
      });

      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action:
          nextStatus === undefined
            ? "admin.commerce.offer_updated"
            : "admin.commerce.offer_status_changed",
        targetType: "commerce_offer",
        targetId: offerId,
        requestId,
        metadata: {
          code: offer.code,
          ...(nextStatus === undefined
            ? {}
            : { before: offer.status, after: nextStatus }),
          ...(input.grants === undefined
            ? {}
            : {
                grantsBefore: offer.grants
                  .map((grant) => grant.entitlementKey)
                  .sort(),
                grantsAfter: updated.grants
                  .map((grant) => grant.entitlementKey)
                  .sort(),
              }),
        },
      });
      return updated;
    });
  }

  async createProduct(
    actor: AdminUser,
    offerId: string,
    input: StoreProductCreateInput,
    requestId: string,
  ): Promise<StoreProduct> {
    // The mistake this section exists to prevent: mapping a Sandbox product
    // while looking at production, or the reverse. The same product id in
    // two stores is two different products, and only one of them is the one
    // this deployment can ever verify a purchase against.
    if (input.storeEnvironment !== this.storeEnvironment) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "STORE_ENVIRONMENT_MISMATCH",
        `This deployment talks to ${this.storeEnvironment}; a ${input.storeEnvironment} product cannot be mapped here`,
        { storeEnvironment: this.storeEnvironment },
      );
    }

    return this.database.$transaction(async (transaction) => {
      const offer = await transaction.commerceOffer.findUnique({
        where: { id: offerId },
        select: { id: true, code: true, status: true },
      });
      if (offer === null) {
        notFound();
      }
      if (offer.status === CommerceOfferStatus.RETIRED) {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "COMMERCE_OFFER_RETIRED",
          "A retired offer is not given a new store listing",
        );
      }
      const existing = await transaction.storeProduct.findFirst({
        where: {
          provider: input.provider,
          storeEnvironment: input.storeEnvironment,
          bundleId: input.bundleId,
          productId: input.productId,
        },
        select: { id: true, offerId: true },
      });
      if (existing !== null) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "STORE_PRODUCT_ALREADY_MAPPED",
          `${input.productId} is already mapped in ${input.storeEnvironment}`,
          { productId: existing.id, offerId: existing.offerId },
        );
      }

      const created = await transaction.storeProduct.create({
        data: {
          offerId,
          provider: input.provider,
          storeEnvironment: input.storeEnvironment,
          bundleId: input.bundleId,
          productId: input.productId,
          productType: input.productType,
        },
      });
      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action: "admin.commerce.store_product_mapped",
        targetType: "store_product",
        targetId: created.id,
        requestId,
        metadata: {
          offerCode: offer.code,
          provider: created.provider,
          storeEnvironment: created.storeEnvironment,
          bundleId: created.bundleId,
          productId: created.productId,
          productType: created.productType,
        },
      });
      return created;
    });
  }

  async updateProduct(
    actor: AdminUser,
    productId: string,
    input: StoreProductUpdateInput,
    requestId: string,
  ): Promise<StoreProduct> {
    return this.database.$transaction(async (transaction) => {
      const product = await transaction.storeProduct.findUnique({
        where: { id: productId },
      });
      if (product === null) {
        notFound();
      }
      const updated = await transaction.storeProduct.update({
        where: { id: productId },
        data: { status: input.status },
      });
      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action: "admin.commerce.store_product_status_changed",
        targetType: "store_product",
        targetId: productId,
        requestId,
        metadata: {
          storeEnvironment: product.storeEnvironment,
          productId: product.productId,
          before: product.status,
          after: updated.status,
        },
      });
      return updated;
    });
  }

  private async assertEntitlementsExist(
    transaction: Prisma.TransactionClient,
    grants: string[],
  ): Promise<void> {
    const known = await transaction.entitlementDefinition.findMany({
      where: { key: { in: grants }, status: EntitlementStatus.ACTIVE },
      select: { key: true },
    });
    const missing = grants.filter(
      (key) => !known.some((entitlement) => entitlement.key === key),
    );
    if (missing.length > 0) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "ENTITLEMENT_NOT_FOUND",
        `No active entitlement exists for: ${missing.join(", ")}`,
        { keys: missing },
      );
    }
  }

  /**
   * An offer goes on sale only where it can actually be sold.
   *
   * Without a store listing this deployment can verify against, an ACTIVE
   * offer is a paywall with no way through it, and the customer is the one
   * who finds out.
   */
  private async assertSellableHere(
    transaction: Prisma.TransactionClient,
    offerId: string,
    code: string,
  ): Promise<void> {
    const sellable = await transaction.storeProduct.findFirst({
      where: {
        offerId,
        storeEnvironment: this.storeEnvironment,
        status: { in: SELLABLE_PRODUCT_STATUSES },
      },
      select: { id: true },
    });
    if (sellable === null) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "STORE_PRODUCT_NOT_VALIDATED",
        `${code} has no validated ${this.storeEnvironment} product, so activating it would sell nothing`,
        { storeEnvironment: this.storeEnvironment },
      );
    }
  }

  /**
   * Grants may grow and never shrink once an offer has left draft.
   *
   * A purchase bought a set of rights. Taking one away would silently make
   * the thing somebody paid for smaller, and there is no way to tell that
   * customer apart from a new one: a different set of rights is a different
   * product, and gets a different offer.
   */
  private async grantsToRemove(
    transaction: Prisma.TransactionClient,
    offer: OfferWithRelations,
    grants: string[],
    actor: AdminUser,
  ): Promise<string[]> {
    await this.assertEntitlementsExist(transaction, grants);

    const before = offer.grants.map((grant) => grant.entitlementKey);
    const removed = before.filter((key) => !grants.includes(key));
    const added = grants.filter((key) => !before.includes(key));
    const published = offer.status !== CommerceOfferStatus.DRAFT;
    const sold = await this.hasSold(transaction, offer.products);

    if (removed.length > 0 && (published || sold)) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "COMMERCE_OFFER_GRANTS_SHRUNK",
        `${offer.code} has been on sale; its grants may grow but never shrink — a different set of rights is a different offer`,
        { removed },
      );
    }
    // Widening what a sold product opens is a migration rather than a copy
    // edit: everybody who already bought it gets the new right too.
    if (
      added.length > 0 &&
      (published || sold) &&
      !roleSatisfies(actor.role, AdminRole.PUBLISHER)
    ) {
      forbidden(
        AdminRole.PUBLISHER,
        "Widening the grants of an offer that has been on sale requires the PUBLISHER role",
      );
    }
    return removed;
  }

  private async hasSold(
    transaction: Prisma.TransactionClient,
    products: StoreProduct[],
  ): Promise<boolean> {
    if (products.length === 0) {
      return false;
    }
    const sale = await transaction.storeTransaction.findFirst({
      where: {
        OR: products.map((product) => ({
          provider: product.provider,
          storeEnvironment: product.storeEnvironment,
          productId: product.productId,
        })),
      },
      select: { id: true },
    });
    return sale !== null;
  }
}
