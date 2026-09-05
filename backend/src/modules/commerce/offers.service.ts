import { Injectable } from "@nestjs/common";
import {
  CommerceOfferStatus,
  StoreProductStatus,
  StoreProvider,
} from "@prisma/client";

import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AppleStoreConfig } from "./apple/apple-store.config";

export const COMMERCE_PLATFORMS = ["IOS", "ANDROID", "WEB"] as const;

export type CommercePlatform = (typeof COMMERCE_PLATFORMS)[number];

const PROVIDER: Record<CommercePlatform, StoreProvider> = {
  IOS: StoreProvider.APPLE_APP_STORE,
  ANDROID: StoreProvider.GOOGLE_PLAY,
  WEB: StoreProvider.WEB,
};

export interface CommerceOfferView {
  code: string;
  kind: string;
  storeProduct?: { provider: StoreProvider; productId: string };
  grants: string[];
  title: string | null;
  description: string | null;
}

/**
 * What is for sale, in this product's terms.
 *
 * There is no price here and there will not be one. The store owns what a
 * thing costs — it is the only place a localized, review-approved price
 * exists, and a price kept anywhere else is a price that is wrong in some
 * country by tomorrow. Nothing in authorization reads one either: a deck is
 * opened by a grant, never by what somebody paid.
 */
@Injectable()
export class OffersService {
  constructor(
    private readonly database: PrismaService,
    private readonly appleStore: AppleStoreConfig,
  ) {}

  async list(platform: CommercePlatform): Promise<CommerceOfferView[]> {
    const provider = PROVIDER[platform];
    const offers = await this.database.commerceOffer.findMany({
      where: { status: CommerceOfferStatus.ACTIVE },
      select: {
        code: true,
        kind: true,
        sortOrder: true,
        grants: {
          select: { entitlementKey: true },
          orderBy: { entitlementKey: "asc" },
        },
        localizations: {
          select: { locale: true, title: true, description: true },
          orderBy: { locale: "asc" },
        },
        products: {
          // Only what this deployment can actually sell: the same product
          // identifier in Sandbox and in Production are two different
          // things, and offering one where the other is verified is how a
          // test purchase would open a paid deck for real.
          //
          // The environment comes from the Apple configuration for every
          // provider because it is really the deployment's own — dev is the
          // test store, prod is the live one — and Apple is the only store
          // this version sells through. A Google Play or Web boundary of its
          // own arrives with those providers (ADR-019).
          where: {
            provider,
            storeEnvironment: this.appleStore.storeEnvironment,
            status: {
              in: [StoreProductStatus.ACTIVE, StoreProductStatus.VALIDATED],
            },
          },
          select: { provider: true, productId: true },
          orderBy: { productId: "asc" },
          take: 1,
        },
      },
    });

    // Ordered here rather than in SQL because the editorial rank is nullable
    // and an unranked offer belongs at the end, not where a NULLS FIRST
    // default would put it.
    return [...offers]
      .sort((left, right) => {
        const byRank =
          (left.sortOrder ?? Number.MAX_SAFE_INTEGER) -
          (right.sortOrder ?? Number.MAX_SAFE_INTEGER);
        return byRank === 0 ? left.code.localeCompare(right.code) : byRank;
      })
      .map((offer) => {
        const product = offer.products[0];
        const copy = this.copyFor(offer.localizations);
        return {
          code: offer.code,
          kind: offer.kind,
          // Optional on purpose: an offer whose store listing is not ready
          // still has copy and still resolves a deck's `offerCodes`, and a
          // paywall that can say "not available yet" is better than one that
          // shows nothing at all.
          ...(product === undefined ? {} : { storeProduct: product }),
          grants: offer.grants.map(({ entitlementKey }) => entitlementKey),
          title: copy?.title ?? null,
          description: copy?.description ?? null,
        };
      });
  }

  /**
   * Fallback copy only, and unlocalized on purpose.
   *
   * The endpoint takes no locale because what a customer reads at the moment
   * of paying comes from the store, localized and approved by App Review;
   * this text is what a client shows in the seconds before StoreKit answers,
   * or when it never does. English first, then whatever the offer has, so
   * the field is never empty when the console filled it in. Choosing by
   * request locale would mean a new query parameter, and that is a contract
   * change rather than something to smuggle in.
   */
  private copyFor(
    localizations: Array<{
      locale: string;
      title: string;
      description: string;
    }>,
  ): { title: string; description: string } | undefined {
    return (
      localizations.find(
        (entry) => entry.locale.split("-")[0]?.toLowerCase() === "en",
      ) ?? localizations[0]
    );
  }
}
