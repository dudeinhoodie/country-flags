import type { ContentDraft } from "@prisma/client";

import { DeckAccessService } from "../commerce/deck-access.service";
import { ContentAccessProjectionService } from "../content/content-access-projection.service";
import type { PrismaService } from "../../infrastructure/database/prisma.service";
import type { AdminDraftsService } from "./admin-drafts.service";
import { DraftReadModelService } from "./draft-read-model.service";
import { DraftValidationService } from "./draft-validation.service";
import { TaxonomySourceService } from "./taxonomy-source.service";

/**
 * The admin's delivery badge and the public projection are the same verdict.
 *
 * These are the cases the console has to get right before an editor can trust
 * the badge: a symbol only a paid deck reaches is paid-only, the same symbol
 * chosen as a preview is public on purpose, and a country taught for free
 * stays public whatever else is hung off her (ADR-019, #356).
 */

const DECKS = {
  free: {
    key: "deck.all-countries",
    kind: "curated" as const,
    names: {
      ru: { name: "Все", description: "Все страны" },
      en: { name: "All", description: "All countries" },
    },
    members: "all-current" as const,
  },
  paid: {
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
    access: {
      model: "ENTITLEMENT" as const,
      requiredEntitlementKey: "deck.european_coats",
    },
  },
  states: {
    key: "deck.us-states",
    kind: "curated" as const,
    names: {
      ru: { name: "Штаты", description: "Штаты США" },
      en: { name: "States", description: "U.S. states" },
    },
    members: ["subdivision.us.california"],
    defaultTemplateCode: "FLAG_TO_COUNTRY",
    defaultTemplateSchemaVersion: 1,
    access: {
      model: "ENTITLEMENT" as const,
      requiredEntitlementKey: "deck.us_states",
    },
  },
};

function entity(
  key: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    key,
    type: "country",
    status: "active",
    config: { includeInCountryCatalog: true },
    recognitionStatus: "un_member",
    ...overrides,
  };
}

function document(decks: unknown[]): Record<string, unknown> {
  return {
    schemaVersion: 3,
    defaultLocale: "ru",
    supportedLocales: ["ru", "en"],
    entities: [
      entity("country.germany"),
      entity("country.united_states"),
      entity("subdivision.us.california", {
        type: "subdivision",
        parentKey: "country.united_states",
        recognitionStatus: "not_applicable",
        config: { includeInCountryCatalog: false },
      }),
    ],
    additionalRelations: [],
    decks,
  };
}

function readModel(
  decks: unknown[],
  uploads: { entityContentKey: string; assetType: string }[] = [],
): DraftReadModelService {
  const database = {
    geoEntity: { findMany: () => Promise.resolve([]) },
    geoRelation: { findMany: () => Promise.resolve([]) },
    draftAsset: { findMany: () => Promise.resolve(uploads) },
  } as unknown as PrismaService;
  const drafts = {
    get: () =>
      Promise.resolve({
        id: "draft-1",
        revision: 4,
        document: document(decks),
      } as unknown as ContentDraft),
    publishedDeckAccess: () => Promise.resolve([]),
  } as unknown as AdminDraftsService;
  return new DraftReadModelService(
    database,
    drafts,
    new TaxonomySourceService(database),
    new DraftValidationService(),
    // The real policy, not a stand-in: a second implementation of "who may
    // see this" is exactly what this endpoint exists to avoid.
    new ContentAccessProjectionService(
      database,
      new DeckAccessService(database),
    ),
  );
}

describe("DraftReadModelService", () => {
  it("calls a coat only an entitlement deck teaches paid-only", async () => {
    const service = readModel([DECKS.free, DECKS.paid]);
    const context = await service.context("draft-1");

    const delivery = await service.assetSlotDelivery(
      [
        service.slotKey("country.germany", "COAT_OF_ARMS"),
        service.slotKey("country.germany", "FLAG"),
      ],
      context.reach,
    );

    expect(delivery.get("country.germany#COAT_OF_ARMS")).toBe("PAID_ONLY");
    // The same country's flag is in the free deck, so it stays public: what
    // is paid is the route to the drawing, not the country.
    expect(delivery.get("country.germany#FLAG")).toBe("PUBLIC");
  });

  it("calls the same coat a public preview once the deck shows it", async () => {
    const service = readModel([
      DECKS.free,
      {
        ...DECKS.paid,
        previewCards: [
          {
            entityKey: "country.germany",
            templateCode: "COAT_OF_ARMS_TO_COUNTRY",
            templateSchemaVersion: 1,
          },
        ],
      },
    ]);
    const context = await service.context("draft-1");

    const delivery = await service.assetSlotDelivery(
      [service.slotKey("country.germany", "COAT_OF_ARMS")],
      context.reach,
    );

    expect(delivery.get("country.germany#COAT_OF_ARMS")).toBe("PUBLIC_PREVIEW");
  });

  it("keeps a country the free deck teaches public and withholds a state only the paid deck teaches", async () => {
    const service = readModel([DECKS.free, DECKS.paid, DECKS.states]);
    const context = await service.context("draft-1");

    const delivery = await service.entityDelivery(
      ["country.germany", "subdivision.us.california"],
      context.reach,
    );

    expect(delivery.get("country.germany")).toBe("PUBLIC");
    expect(delivery.get("subdivision.us.california")).toBe("PAID_ONLY");
  });

  it("withholds a drawing no deck reaches at all", async () => {
    const service = readModel(
      [DECKS.free],
      [{ entityContentKey: "country.germany", assetType: "COAT_OF_ARMS" }],
    );
    const context = await service.context("draft-1");

    const delivery = await service.assetSlotDelivery(
      [service.slotKey("country.germany", "COAT_OF_ARMS")],
      context.reach,
    );

    // Uploaded but taught by nothing: publishing it would put artwork on a
    // public URL that no editorial decision has made free.
    expect(delivery.get("country.germany#COAT_OF_ARMS")).toBe("PAID_ONLY");
  });

  it("counts the decks a deck cannot be resolved from as holding nothing", async () => {
    const service = readModel([
      {
        ...DECKS.free,
        key: "deck.europe",
        members: { taxonomy: "region.europe" },
      },
    ]);

    const context = await service.context("draft-1");

    // The taxonomy node is unknown to the active release, so the deck
    // resolves to nothing here — and the screen still opens.
    expect(context.reach.cards).toEqual([]);
  });

  it("reads the whole aggregate in one pass over the catalog", async () => {
    const service = readModel([DECKS.free, DECKS.paid]);
    const context = await service.context("draft-1");

    expect(context.draft.revision).toBe(4);
    expect(context.reach.usageByEntity.get("country.germany")).toHaveLength(2);
    expect(
      context.reach.usageByEntity
        .get("country.germany")
        ?.map((card) => card.deckKey)
        .sort(),
    ).toEqual(["deck.all-countries", "deck.european-coats"]);
  });
});
