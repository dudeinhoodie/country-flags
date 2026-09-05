import { NotFoundException } from "@nestjs/common";
import {
  AssetStatus,
  AssetType,
  DeckAccessModel,
  GeoEntityKind,
  GeoEntityStatus,
  GeoNameType,
  RecognitionStatus,
} from "@prisma/client";

import type { PrismaService } from "../../infrastructure/database/prisma.service";
import { DeckAccessService } from "../commerce/deck-access.service";
import { ContentAccessProjectionService } from "./content-access-projection.service";
import { ContentService } from "./content.service";

const GERMANY_ID = "30000000-0000-4000-8000-000000000003";
const CALIFORNIA_ID = "30000000-0000-4000-8000-00000000000a";
const FLAG_ASSET_ID = "40000000-0000-4000-8000-000000000003";
const COAT_ASSET_ID = "40000000-0000-4000-8000-00000000000a";
const COAT_URL = "https://cdn.country-flags.test/content/v1/coats/germany.svg";

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

function asset(
  id: string,
  assetType: AssetType,
  url: string,
): Record<string, unknown> {
  return {
    id,
    geoEntityId: GERMANY_ID,
    assetType,
    status: AssetStatus.PUBLISHED,
    width: 640,
    height: 384,
    aspectRatio: null,
    licenseName: "MIT",
    attribution: "flag-icons contributors",
    representations: [
      {
        publicUrl: url,
        mimeType: "image/svg+xml",
        sha256: "a".repeat(64),
        scale: null,
        widthPx: null,
        heightPx: null,
      },
    ],
  };
}

const germany = {
  id: GERMANY_ID,
  kind: GeoEntityKind.COUNTRY,
  status: GeoEntityStatus.ACTIVE,
  recognitionStatus: RecognitionStatus.UN_MEMBER,
  contentVersion: "v1",
  names: [
    {
      locale: "en",
      value: "Germany",
      isPrimary: true,
      nameType: GeoNameType.SHORT,
    },
  ],
  facts: [],
  assets: [
    asset(
      FLAG_ASSET_ID,
      AssetType.FLAG,
      "https://cdn.country-flags.test/content/v1/flags/germany.svg",
    ),
    asset(COAT_ASSET_ID, AssetType.COAT_OF_ARMS, COAT_URL),
  ],
};

interface MembershipQuery {
  where: {
    learningCard?: {
      subjectEntityId?: { in: string[] };
      revisions?: { some: { promptAssetId: { in: string[] } } };
    };
  };
}

/**
 * The public entity projection: Germany's free flag, and not the coat of arms
 * only a paid deck teaches.
 */
describe("ContentService public entity projection", () => {
  const contentPointer = { findUnique: jest.fn() };
  const geoEntity = { findFirst: jest.fn() };
  const deckCard = { findMany: jest.fn() };
  const userEntitlementGrant = { findFirst: jest.fn() };
  const prisma = {
    contentPointer,
    geoEntity,
    deckCard,
    userEntitlementGrant,
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
    geoEntity.findFirst.mockResolvedValue(germany);
    // Germany is taught for free; her coat is prompted by a card only the
    // paid deck holds.
    deckCard.findMany.mockImplementation((query: MembershipQuery) =>
      Promise.resolve(
        query.where.learningCard?.subjectEntityId === undefined
          ? [
              {
                isPreview: false,
                deck: paidDeck,
                learningCard: { revisions: [{ promptAssetId: COAT_ASSET_ID }] },
              },
              {
                isPreview: false,
                deck: freeDeck,
                learningCard: { revisions: [{ promptAssetId: FLAG_ASSET_ID }] },
              },
            ]
          : [
              {
                isPreview: false,
                deck: freeDeck,
                learningCard: { subjectEntityId: GERMANY_ID },
              },
            ],
      ),
    );
  });

  it("serves the free flag and withholds the paid coat, URL and all", async () => {
    const entity = await service.getEntity(GERMANY_ID, "en");

    expect(entity).toMatchObject({
      id: GERMANY_ID,
      name: { short: "Germany" },
      assets: [{ id: FLAG_ASSET_ID, type: AssetType.FLAG }],
    });
    // Not the metadata, not the licence, and above all not the address the
    // bytes are at.
    const body = JSON.stringify(entity);
    expect(body).not.toContain(COAT_ASSET_ID);
    expect(body).not.toContain(COAT_URL);
    expect(body).not.toContain(AssetType.COAT_OF_ARMS);
  });

  it("serves the coat once a free card prompts with it", async () => {
    deckCard.findMany.mockImplementation((query: MembershipQuery) =>
      Promise.resolve(
        query.where.learningCard?.subjectEntityId === undefined
          ? [
              {
                isPreview: false,
                deck: freeDeck,
                learningCard: { revisions: [{ promptAssetId: COAT_ASSET_ID }] },
              },
              {
                isPreview: false,
                deck: freeDeck,
                learningCard: { revisions: [{ promptAssetId: FLAG_ASSET_ID }] },
              },
            ]
          : [
              {
                isPreview: false,
                deck: freeDeck,
                learningCard: { subjectEntityId: GERMANY_ID },
              },
            ],
      ),
    );

    const entity = await service.getEntity(GERMANY_ID, "en");

    // A drawing one free card uses is public for the whole release, whether
    // or not a paid deck also teaches it.
    expect(entity.assets).toEqual([
      expect.objectContaining({ id: FLAG_ASSET_ID }),
      expect.objectContaining({ id: COAT_ASSET_ID }),
    ]);
  });

  it("answers for a place only a paid deck teaches the way it answers for one that does not exist", async () => {
    geoEntity.findFirst.mockResolvedValue({
      ...germany,
      id: CALIFORNIA_ID,
      assets: [],
    });
    deckCard.findMany.mockImplementation((query: MembershipQuery) =>
      Promise.resolve(
        query.where.learningCard?.subjectEntityId === undefined
          ? []
          : [
              {
                isPreview: false,
                deck: paidDeck,
                learningCard: { subjectEntityId: CALIFORNIA_ID },
              },
            ],
      ),
    );

    const thrown = await service
      .getEntity(CALIFORNIA_ID, "en")
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(NotFoundException);
    // The same words a missing id gets, so the route cannot be used to tell
    // "sold, and not to you" from "never existed".
    expect((thrown as NotFoundException).message).toBe("Entity was not found");
  });

  it("never reads a grant on the way", async () => {
    await service.getEntity(GERMANY_ID, "en");

    expect(userEntitlementGrant.findFirst).not.toHaveBeenCalled();
  });
});
