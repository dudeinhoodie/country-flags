import { DeckAccessModel } from "@prisma/client";

import type { PrismaService } from "../../infrastructure/database/prisma.service";
import { DeckAccessService } from "../commerce/deck-access.service";
import {
  ContentAccessProjectionService,
  type ContentVisibility,
  isPubliclyVisible,
  isVisibleToClient,
} from "./content-access-projection.service";

const FLAG_ASSET_ID = "40000000-0000-4000-8000-000000000001";
const COAT_ASSET_ID = "40000000-0000-4000-8000-00000000000a";
const RETIRED_ASSET_ID = "40000000-0000-4000-8000-00000000000b";
const FLAG_CARD_ID = "60000000-0000-4000-8000-000000000001";
const COAT_CARD_ID = "60000000-0000-4000-8000-00000000000a";
const GERMANY_ID = "30000000-0000-4000-8000-000000000003";
const CALIFORNIA_ID = "30000000-0000-4000-8000-00000000000a";
const EUROPE_REGION_ID = "30000000-0000-4000-8000-0000000000f0";

const freeDeck = {
  id: "70000000-0000-4000-8000-000000000001",
  accessModel: DeckAccessModel.FREE,
  requiredEntitlementKey: null,
};
const paidDeck = {
  id: "70000000-0000-4000-8000-00000000000a",
  accessModel: DeckAccessModel.ENTITLEMENT,
  requiredEntitlementKey: "entitlement.european_coats",
};

describe("ContentAccessProjectionService", () => {
  const deckCard = { findMany: jest.fn() };
  const userEntitlementGrant = { findFirst: jest.fn() };
  const commerceOfferGrant = { findMany: jest.fn() };
  const prisma = {
    deckCard,
    userEntitlementGrant,
    commerceOfferGrant,
  } as unknown as PrismaService;
  const service = new ContentAccessProjectionService(
    prisma,
    new DeckAccessService(prisma),
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("assets", () => {
    it("keeps a drawing a free deck reaches, whoever else sells it", async () => {
      // Germany's flag is prompted by one card, and that card is in the free
      // "All countries" deck as well as a paid European set.
      deckCard.findMany.mockResolvedValue([
        {
          isPreview: false,
          deck: freeDeck,
          learningCard: { revisions: [{ promptAssetId: FLAG_ASSET_ID }] },
        },
        {
          isPreview: false,
          deck: paidDeck,
          learningCard: { revisions: [{ promptAssetId: FLAG_ASSET_ID }] },
        },
      ]);

      await expect(service.assetVisibility([FLAG_ASSET_ID])).resolves.toEqual(
        new Map([[FLAG_ASSET_ID, "PUBLIC"]]),
      );
    });

    it("withholds a drawing only an entitlement deck reaches", async () => {
      deckCard.findMany.mockResolvedValue([
        {
          isPreview: false,
          deck: paidDeck,
          learningCard: { revisions: [{ promptAssetId: COAT_ASSET_ID }] },
        },
      ]);

      await expect(service.assetVisibility([COAT_ASSET_ID])).resolves.toEqual(
        new Map([[COAT_ASSET_ID, "PAID_ONLY"]]),
      );
    });

    it("publishes a drawing the locked deck previews on purpose", async () => {
      deckCard.findMany.mockResolvedValue([
        {
          isPreview: true,
          deck: paidDeck,
          learningCard: { revisions: [{ promptAssetId: COAT_ASSET_ID }] },
        },
      ]);

      await expect(service.assetVisibility([COAT_ASSET_ID])).resolves.toEqual(
        new Map([[COAT_ASSET_ID, "PUBLIC_PREVIEW"]]),
      );
    });

    it("withholds a drawing no published deck reaches at all", async () => {
      // Artwork imported before the deck that will sell it exists. The
      // projection publishes what is known to be free, not what has not yet
      // been proved paid.
      deckCard.findMany.mockResolvedValue([]);

      await expect(service.assetVisibility([COAT_ASSET_ID])).resolves.toEqual(
        new Map([[COAT_ASSET_ID, "PAID_ONLY"]]),
      );
    });

    it("does not let a card lend its deck to a drawing it has replaced", async () => {
      // The card is in the free deck, but its current revision prompts with
      // the new drawing; the one it left behind is reached by nothing.
      deckCard.findMany.mockResolvedValue([
        {
          isPreview: false,
          deck: freeDeck,
          learningCard: { revisions: [{ promptAssetId: FLAG_ASSET_ID }] },
        },
      ]);

      await expect(
        service.assetVisibility([FLAG_ASSET_ID, RETIRED_ASSET_ID]),
      ).resolves.toEqual(
        new Map([
          [FLAG_ASSET_ID, "PUBLIC"],
          [RETIRED_ASSET_ID, "PAID_ONLY"],
        ]),
      );
    });

    it("reads no account at all", async () => {
      deckCard.findMany.mockResolvedValue([
        {
          isPreview: false,
          deck: paidDeck,
          learningCard: { revisions: [{ promptAssetId: COAT_ASSET_ID }] },
        },
      ]);

      await service.assetVisibility([COAT_ASSET_ID]);

      // The public projection is the same for everybody: it asks whether
      // anybody may open the deck, never whether this reader has bought it.
      // An answer that varied by bearer could not be cached in front of the
      // service without being handed to the wrong reader.
      expect(userEntitlementGrant.findFirst).not.toHaveBeenCalled();
      expect(commerceOfferGrant.findMany).not.toHaveBeenCalled();
    });
  });

  describe("cards", () => {
    it("keeps a card the free deck holds and withholds the one it does not", async () => {
      deckCard.findMany.mockResolvedValue([
        { learningCardId: FLAG_CARD_ID, isPreview: false, deck: freeDeck },
        { learningCardId: FLAG_CARD_ID, isPreview: false, deck: paidDeck },
        { learningCardId: COAT_CARD_ID, isPreview: false, deck: paidDeck },
      ]);

      await expect(
        service.cardVisibility([FLAG_CARD_ID, COAT_CARD_ID]),
      ).resolves.toEqual(
        new Map([
          [FLAG_CARD_ID, "PUBLIC"],
          [COAT_CARD_ID, "PAID_ONLY"],
        ]),
      );
    });
  });

  describe("entities", () => {
    it("withholds a place only a paid deck teaches and keeps one taught for free", async () => {
      deckCard.findMany.mockResolvedValue([
        {
          isPreview: false,
          deck: freeDeck,
          learningCard: { subjectEntityId: GERMANY_ID },
        },
        {
          isPreview: false,
          deck: paidDeck,
          learningCard: { subjectEntityId: GERMANY_ID },
        },
        {
          isPreview: false,
          deck: paidDeck,
          learningCard: { subjectEntityId: CALIFORNIA_ID },
        },
      ]);

      await expect(
        service.entityVisibility([GERMANY_ID, CALIFORNIA_ID]),
      ).resolves.toEqual(
        new Map([
          [GERMANY_ID, "PUBLIC"],
          [CALIFORNIA_ID, "PAID_ONLY"],
        ]),
      );
    });

    it("keeps a place no card teaches", async () => {
      // A region is structure rather than merchandise: nothing sells it, the
      // free client navigates by it, and closing it would shut a door nobody
      // was coming through.
      deckCard.findMany.mockResolvedValue([]);

      await expect(
        service.entityVisibility([EUROPE_REGION_ID]),
      ).resolves.toEqual(new Map([[EUROPE_REGION_ID, "PUBLIC"]]));
    });
  });

  it("asks the database nothing when there is nothing to classify", async () => {
    await expect(service.assetVisibility([])).resolves.toEqual(new Map());
    await expect(service.cardVisibility([])).resolves.toEqual(new Map());
    await expect(service.entityVisibility([])).resolves.toEqual(new Map());

    expect(deckCard.findMany).not.toHaveBeenCalled();
  });
});

describe("isVisibleToClient", () => {
  const visibilities: ContentVisibility[] = [
    "PUBLIC",
    "PUBLIC_PREVIEW",
    "PAID_ONLY",
  ];

  it("shows a build that understands paid decks the whole public projection", () => {
    expect(
      visibilities.map((visibility) => isVisibleToClient(visibility, true)),
    ).toEqual(visibilities.map(isPubliclyVisible));
  });

  it("shows an older build the catalog it would have if nothing were locked", () => {
    // A preview is a locked deck's shop window. A build with no window to put
    // it in would hold a drawing it can reach through nothing.
    expect(
      visibilities.map((visibility) => isVisibleToClient(visibility, false)),
    ).toEqual([true, false, false]);
  });
});
