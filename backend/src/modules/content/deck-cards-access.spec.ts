import { HttpStatus } from "@nestjs/common";
import { DeckAccessModel } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import type { PrismaService } from "../../infrastructure/database/prisma.service";
import { DeckAccessService } from "../commerce/deck-access.service";
import { ContentAccessProjectionService } from "./content-access-projection.service";
import { ContentService } from "./content.service";

const USER_ID = "80000000-0000-4000-8000-000000000001";
const FREE_DECK_ID = "70000000-0000-4000-8000-000000000001";
const PAID_DECK_ID = "70000000-0000-4000-8000-000000000002";

const freeDeckRow = {
  id: FREE_DECK_ID,
  code: "ALL",
  kind: "CURATED",
  accessModel: DeckAccessModel.FREE,
  requiredEntitlementKey: null,
  contentVersion: "test-only-fixture-v1",
  localizations: [
    { locale: "en", name: "All countries", description: "Every country" },
  ],
  _count: { cards: 12 },
};

const paidDeckRow = {
  id: PAID_DECK_ID,
  code: "EUROPEAN_COATS",
  kind: "CURATED",
  accessModel: DeckAccessModel.ENTITLEMENT,
  requiredEntitlementKey: "entitlement.european_coats",
  contentVersion: "test-only-fixture-v1",
  localizations: [
    { locale: "en", name: "Coats of Europe", description: "Coats of arms" },
  ],
  _count: { cards: 52 },
};

describe("ContentService deck access", () => {
  const contentPointer = { findUnique: jest.fn() };
  const deck = { findMany: jest.fn(), findFirst: jest.fn() };
  const deckCard = { findMany: jest.fn() };
  const userEntitlementGrant = { findFirst: jest.fn() };
  const commerceOfferGrant = { findMany: jest.fn() };
  const $queryRaw = jest.fn();
  const prisma = {
    contentPointer,
    deck,
    deckCard,
    userEntitlementGrant,
    commerceOfferGrant,
    $queryRaw,
  } as unknown as PrismaService;
  const deckAccess = new DeckAccessService(prisma);
  const service = new ContentService(
    prisma,
    deckAccess,
    new ContentAccessProjectionService(prisma, deckAccess),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    contentPointer.findUnique.mockResolvedValue({
      release: {
        manifestChecksum: "0".repeat(64),
        metadata: { manifest: { defaultLocale: "en" } },
      },
    });
    userEntitlementGrant.findFirst.mockResolvedValue(null);
    commerceOfferGrant.findMany.mockResolvedValue([
      {
        entitlementKey: "entitlement.european_coats",
        offer: { code: "EUROPEAN_COATS_LIFETIME", sortOrder: 10 },
      },
    ]);
    deckCard.findMany.mockResolvedValue([]);
    $queryRaw.mockResolvedValue([]);
  });

  it("publishes the locked deck in the catalog with its access policy", async () => {
    deck.findMany.mockResolvedValue([freeDeckRow, paidDeckRow]);

    const page = await service.listDecks("en", undefined, 50);

    expect(page.items).toEqual([
      expect.objectContaining({
        id: FREE_DECK_ID,
        cardCount: 12,
        access: { model: DeckAccessModel.FREE },
      }),
      expect.objectContaining({
        id: PAID_DECK_ID,
        // Metadata and card count stay public: a deck nobody can discover is
        // a deck nobody buys.
        cardCount: 52,
        access: {
          model: DeckAccessModel.ENTITLEMENT,
          requiredEntitlementKey: "entitlement.european_coats",
          offerCodes: ["EUROPEAN_COATS_LIFETIME"],
        },
      }),
    ]);
    expect(JSON.stringify(page.items)).not.toMatch(/price/i);
  });

  it("hands the locked deck's own page to a caller with no account", async () => {
    deck.findFirst.mockResolvedValue(paidDeckRow);

    await expect(service.getDeck(PAID_DECK_ID, "en")).resolves.toMatchObject({
      id: PAID_DECK_ID,
      name: "Coats of Europe",
      access: {
        model: DeckAccessModel.ENTITLEMENT,
        offerCodes: ["EUROPEAN_COATS_LIFETIME"],
      },
    });
  });

  it("refuses the locked deck's cards before reading a single one", async () => {
    deck.findFirst.mockResolvedValue({
      id: PAID_DECK_ID,
      accessModel: DeckAccessModel.ENTITLEMENT,
      requiredEntitlementKey: "entitlement.european_coats",
    });

    const thrown = await service
      .listDeckCards(PAID_DECK_ID, USER_ID, "en", undefined, 50)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ApiException);
    const failure = thrown as ApiException;
    expect(failure.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(failure.getResponse()).toEqual({
      error: {
        code: "ENTITLEMENT_REQUIRED",
        message: "This deck requires a purchase",
        details: {
          deckId: PAID_DECK_ID,
          offerCodes: ["EUROPEAN_COATS_LIFETIME"],
        },
      },
    });
    // Nothing about the deck's composition is read, so nothing about it can
    // leak through a timing difference or a half-built response.
    expect($queryRaw).not.toHaveBeenCalled();
    expect(deckCard.findMany).not.toHaveBeenCalled();
  });

  it("hands the same cards over once the account holds the grant", async () => {
    deck.findFirst.mockResolvedValue({
      id: PAID_DECK_ID,
      accessModel: DeckAccessModel.ENTITLEMENT,
      requiredEntitlementKey: "entitlement.european_coats",
    });
    userEntitlementGrant.findFirst.mockResolvedValue({ id: "grant" });

    await expect(
      service.listDeckCards(PAID_DECK_ID, USER_ID, "en", undefined, 50),
    ).resolves.toEqual({
      items: [],
      page: { nextCursor: null, hasMore: false },
    });
    expect($queryRaw).toHaveBeenCalled();
  });

  it("keeps a free deck's cards open to a guest", async () => {
    deck.findFirst.mockResolvedValue({
      id: FREE_DECK_ID,
      accessModel: DeckAccessModel.FREE,
      requiredEntitlementKey: null,
    });

    await expect(
      service.listDeckCards(FREE_DECK_ID, null, "en", undefined, 50),
    ).resolves.toEqual({
      items: [],
      page: { nextCursor: null, hasMore: false },
    });
    // A card shared with a paid deck is reachable here: the guard protects
    // the paid deck's route, not a globally secret country.
    expect(userEntitlementGrant.findFirst).not.toHaveBeenCalled();
  });
});
