import type { ContentDraft } from "@prisma/client";

import { DeckAccessService } from "../commerce/deck-access.service";
import { ContentAccessProjectionService } from "../content/content-access-projection.service";
import type { PrismaService } from "../../infrastructure/database/prisma.service";
import type { AdminDraftsService } from "./admin-drafts.service";
import { DraftCandidatesService } from "./draft-candidates.service";
import { DraftReadModelService } from "./draft-read-model.service";
import { DraftValidationService } from "./draft-validation.service";
import { TaxonomySourceService } from "./taxonomy-source.service";

/**
 * The deck builder's library answers "may I add this, and if not why".
 *
 * The reasons matter more than the list: a greyed-out row that says nothing
 * is a dead end, and the whole point of moving the search to the server is
 * that the browser never has to know which template needs which drawing.
 */

const DECK = {
  key: "deck.european-coats",
  kind: "curated" as const,
  names: {
    ru: { name: "Гербы", description: "Гербы Европы" },
    en: { name: "Coats", description: "European coats" },
  },
  members: [
    {
      entityKey: "country.germany",
      templateCode: "COAT_OF_ARMS_TO_COUNTRY",
      templateSchemaVersion: 1,
    },
  ],
  defaultTemplateCode: "COAT_OF_ARMS_TO_COUNTRY",
  defaultTemplateSchemaVersion: 1,
};

const DOCUMENT = {
  schemaVersion: 3,
  defaultLocale: "ru",
  supportedLocales: ["ru", "en"],
  entities: [
    {
      key: "country.germany",
      type: "country",
      status: "active",
      config: { includeInCountryCatalog: true },
      recognitionStatus: "un_member",
    },
    {
      key: "country.france",
      type: "country",
      status: "active",
      config: { includeInCountryCatalog: true },
      recognitionStatus: "un_member",
    },
    {
      key: "subdivision.us.california",
      type: "subdivision",
      status: "active",
      parentKey: "country.united_states",
      config: { includeInCountryCatalog: false },
      recognitionStatus: "not_applicable",
    },
    {
      key: "country.zaire",
      type: "country",
      status: "historical",
      config: { includeInCountryCatalog: false },
      recognitionStatus: "un_member",
    },
    {
      key: "region.europe",
      type: "region",
      status: "active",
      config: { includeInCountryCatalog: false },
      recognitionStatus: "not_applicable",
    },
  ],
  additionalRelations: [],
  decks: [DECK],
};

function service(): DraftCandidatesService {
  const database = {
    geoEntity: {
      findMany: () =>
        Promise.resolve([
          {
            contentKey: "country.germany",
            names: [
              { locale: "en", value: "Germany" },
              { locale: "ru", value: "Германия" },
            ],
            // Only Germany has a published coat of arms.
            assets: [{ assetType: "COAT_OF_ARMS" }],
          },
          {
            contentKey: "country.france",
            names: [{ locale: "en", value: "France" }],
            assets: [],
          },
        ]),
    },
    geoRelation: { findMany: () => Promise.resolve([]) },
    draftAsset: { findMany: () => Promise.resolve([]) },
  } as unknown as PrismaService;
  const drafts = {
    get: () =>
      Promise.resolve({
        id: "draft-1",
        revision: 2,
        document: DOCUMENT,
      } as unknown as ContentDraft),
    publishedDeckAccess: () => Promise.resolve([]),
  } as unknown as AdminDraftsService;
  return new DraftCandidatesService(
    new DraftReadModelService(
      database,
      drafts,
      new TaxonomySourceService(database),
      new DraftValidationService(),
      new ContentAccessProjectionService(
        database,
        new DeckAccessService(database),
      ),
    ),
  );
}

describe("DraftCandidatesService", () => {
  it("offers no candidate at all for a subject no template teaches", async () => {
    const { items } = await service().search("draft-1", {
      offset: 0,
      limit: 100,
    });

    // A region is structure. Listing it as permanently unavailable would be
    // offering an editor something that can never become possible.
    expect(items.some((item) => item.entityKey === "region.europe")).toBe(
      false,
    );
  });

  it("says which drawing is missing rather than only that the card is off", async () => {
    const { items } = await service().search("draft-1", {
      templateCode: "COAT_OF_ARMS_TO_COUNTRY",
      offset: 0,
      limit: 100,
    });

    const france = items.find((item) => item.entityKey === "country.france");
    expect(france?.available).toBe(false);
    expect(france?.disabledReason?.code).toBe("ASSET_MISSING");
    expect(france?.disabledReason?.message).toContain("coat_of_arms");
    // Germany's coat is published, so hers is offerable.
    const germany = items.find((item) => item.entityKey === "country.germany");
    expect(germany?.hasAsset).toBe(true);
  });

  it("treats a flag as present because the sources supply one", async () => {
    const { items } = await service().search("draft-1", {
      templateCode: "FLAG_TO_COUNTRY",
      entityType: "subdivision",
      offset: 0,
      limit: 100,
    });

    // The publish gate blocks on a missing coat of arms and not on a missing
    // flag; the library has to agree with it or it would refuse a card the
    // release would happily build.
    expect(items).toHaveLength(1);
    expect(items[0]?.entityKey).toBe("subdivision.us.california");
    expect(items[0]?.available).toBe(true);
  });

  it("marks a card the named deck already holds", async () => {
    const { items } = await service().search("draft-1", {
      deckKey: "deck.european-coats",
      templateCode: "COAT_OF_ARMS_TO_COUNTRY",
      offset: 0,
      limit: 100,
    });

    const germany = items.find((item) => item.entityKey === "country.germany");
    expect(germany?.inDeck).toBe(true);
    expect(germany?.disabledReason?.code).toBe("ALREADY_IN_DECK");
  });

  it("refuses a subject that has no name in the locale the deck needs", async () => {
    const { items } = await service().search("draft-1", {
      locale: "ru",
      templateCode: "FLAG_TO_COUNTRY",
      offset: 0,
      limit: 100,
    });

    const france = items.find((item) => item.entityKey === "country.france");
    expect(france?.disabledReason?.code).toBe("LOCALE_NAME_MISSING");
    // Germany is named in Russian, so she is ready for a Russian deck.
    const germany = items.find((item) => item.entityKey === "country.germany");
    expect(germany?.available).toBe(true);
  });

  it("refuses a subject no release would build a card for", async () => {
    const { items } = await service().search("draft-1", {
      search: "zaire",
      offset: 0,
      limit: 100,
    });

    expect(items[0]?.disabledReason?.code).toBe("ENTITY_NOT_ACTIVE");
  });

  it("filters by parent, and pages what it matched", async () => {
    const byParent = await service().search("draft-1", {
      parentKey: "country.united_states",
      offset: 0,
      limit: 100,
    });
    expect(
      byParent.items.every(
        (item) => item.entityKey === "subdivision.us.california",
      ),
    ).toBe(true);

    const paged = await service().search("draft-1", {
      readiness: "ready",
      offset: 0,
      limit: 1,
    });
    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBeGreaterThan(1);
    expect(paged.draftRevision).toBe(2);
  });
});
