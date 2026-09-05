import { DraftEntitiesService } from "./draft-entities.service";
import type { AdminDraftsService } from "./admin-drafts.service";
import type { PrismaService } from "../../infrastructure/database/prisma.service";
import type { AdminUser, ContentDraft } from "@prisma/client";

const actor = { id: "admin-1" } as AdminUser;

function entity(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    key: "country.france",
    type: "country",
    status: "active",
    config: { includeInCountryCatalog: true },
    recognitionStatus: "un_member",
    identifiers: { isoAlpha2: "FR" },
    ...overrides,
  };
}

/**
 * The service is exercised through the same `applyDocumentChange` contract
 * the real drafts service exposes: the fake hands the mutate callback the
 * current document and records what came back, which is exactly the seam
 * the optimistic-concurrency wrapper owns in production.
 */
function serviceWith(document: Record<string, unknown>): {
  service: DraftEntitiesService;
  written: () => Record<string, unknown> | null;
} {
  let next: Record<string, unknown> | null = null;
  const drafts = {
    get: () => Promise.resolve({ document } as ContentDraft),
    applyDocumentChange: (
      _actor: AdminUser,
      _draftId: string,
      _revision: number,
      mutate: (current: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      next = mutate(document);
      return Promise.resolve({ document: next } as ContentDraft);
    },
  } as unknown as AdminDraftsService;
  const database = {
    geoEntity: {
      findUnique: () => Promise.resolve(null),
      findMany: () => Promise.resolve([]),
    },
    draftAsset: { findMany: () => Promise.resolve([]) },
  } as unknown as PrismaService;
  return {
    service: new DraftEntitiesService(database, drafts),
    written: () => next,
  };
}

describe("DraftEntitiesService", () => {
  it("replaces only the fields the editor sent", async () => {
    const { service, written } = serviceWith({ entities: [entity()] });
    await service.update(
      actor,
      "draft-1",
      1,
      "country.france",
      { status: "hidden", overrides: { "names.ru.short": "Франция" } },
      "req-1",
    );
    const stored = (written()?.entities as Record<string, unknown>[])[0];
    expect(stored?.status).toBe("hidden");
    expect(stored?.overrides).toEqual({ "names.ru.short": "Франция" });
    // Untouched fields survive the update.
    expect(stored?.identifiers).toEqual({ isoAlpha2: "FR" });
    expect(stored?.type).toBe("country");
  });

  it("stores the flat listing toggle inside the entity's config", async () => {
    const { service, written } = serviceWith({ entities: [entity()] });
    await service.update(
      actor,
      "draft-1",
      1,
      "country.france",
      { includeInCountryCatalog: false },
      "req-1",
    );
    const stored = (written()?.entities as Record<string, unknown>[])[0];
    expect(stored?.config).toEqual({ includeInCountryCatalog: false });
    // The flat API field never lands in the document itself.
    expect(stored !== undefined && "includeInCountryCatalog" in stored).toBe(
      false,
    );
  });

  it("drops an emptied overrides map instead of storing {}", async () => {
    const { service, written } = serviceWith({
      entities: [entity({ overrides: { "names.en.short": "Pinned" } })],
    });
    await service.update(
      actor,
      "draft-1",
      1,
      "country.france",
      { overrides: {} },
      "req-1",
    );
    const stored = (written()?.entities as Record<string, unknown>[])[0];
    // The schema forbids an empty overrides object; absence is the encoding.
    expect(stored !== undefined && "overrides" in stored).toBe(false);
  });

  it("clears a date field when the editor sends null", async () => {
    const { service, written } = serviceWith({
      entities: [entity({ validTo: "2020-01-01" })],
    });
    await service.update(
      actor,
      "draft-1",
      1,
      "country.france",
      { validTo: null },
      "req-1",
    );
    const stored = (written()?.entities as Record<string, unknown>[])[0];
    expect(stored !== undefined && "validTo" in stored).toBe(false);
  });

  it("never lets an update move the key", async () => {
    const { service, written } = serviceWith({ entities: [entity()] });
    await service.update(
      actor,
      "draft-1",
      1,
      "country.france",
      { status: "active", key: "country.renamed" } as never,
      "req-1",
    );
    const stored = (written()?.entities as Record<string, unknown>[])[0];
    expect(stored?.key).toBe("country.france");
  });

  it("refuses an entity the draft does not carry", async () => {
    const { service } = serviceWith({ entities: [entity()] });
    await expect(
      service.update(
        actor,
        "draft-1",
        1,
        "country.atlantis",
        { status: "hidden" },
        "req-1",
      ),
    ).rejects.toMatchObject({
      response: { error: { code: "RESOURCE_NOT_FOUND" } },
    });
  });

  it("gives a subdivision the country it belongs to", async () => {
    const { service, written } = serviceWith({
      schemaVersion: 2,
      decks: [{ key: "deck.all", kind: "curated", members: [] }],
      entities: [entity(), entity({ key: "subdivision.us.california" })],
    });
    await service.update(
      actor,
      "draft-1",
      1,
      "subdivision.us.california",
      { type: "subdivision", parentKey: "country.france" },
      "req-1",
    );
    const document = written();
    const stored = (document?.entities as Record<string, unknown>[])[1];
    expect(stored?.type).toBe("subdivision");
    expect(stored?.parentKey).toBe("country.france");
    // v2 has neither the type nor the field, so the document moves to v3.
    expect(document?.schemaVersion).toBe(3);
    expect(
      (document?.decks as Record<string, unknown>[])[0]?.defaultTemplateCode,
    ).toBe("FLAG_TO_COUNTRY");
  });

  it("refuses a subdivision with no parent", async () => {
    const { service } = serviceWith({ entities: [entity()] });
    await expect(
      service.update(
        actor,
        "draft-1",
        1,
        "country.france",
        { type: "subdivision" },
        "req-1",
      ),
    ).rejects.toMatchObject({
      response: { error: { code: "SUBDIVISION_PARENT_REQUIRED" } },
    });
  });

  it("refuses a parent on anything that is not a subdivision", async () => {
    const { service } = serviceWith({
      entities: [entity(), entity({ key: "country.spain" })],
    });
    await expect(
      service.update(
        actor,
        "draft-1",
        1,
        "country.spain",
        { parentKey: "country.france" },
        "req-1",
      ),
    ).rejects.toMatchObject({
      response: { error: { code: "ENTITY_PARENT_NOT_APPLICABLE" } },
    });
  });

  it("refuses a parent that is not a country or a territory", async () => {
    const { service } = serviceWith({
      entities: [
        entity({ key: "region.europe", type: "region" }),
        entity({ key: "subdivision.us.california" }),
      ],
    });
    await expect(
      service.update(
        actor,
        "draft-1",
        1,
        "subdivision.us.california",
        { type: "subdivision", parentKey: "region.europe" },
        "req-1",
      ),
    ).rejects.toMatchObject({
      response: { error: { code: "SUBDIVISION_PARENT_INVALID" } },
    });
  });

  it("refuses a parent the draft does not carry", async () => {
    const { service } = serviceWith({
      entities: [entity({ key: "subdivision.us.california" })],
    });
    await expect(
      service.update(
        actor,
        "draft-1",
        1,
        "subdivision.us.california",
        { type: "subdivision", parentKey: "country.atlantis" },
        "req-1",
      ),
    ).rejects.toMatchObject({
      response: { error: { code: "SUBDIVISION_PARENT_INVALID" } },
    });
  });

  it("keeps a subdivision out of the country catalog", async () => {
    const { service, written } = serviceWith({
      entities: [entity(), entity({ key: "subdivision.us.california" })],
    });
    // The type alone decides it: nothing else about a state has to change
    // for it to stop being a country the catalog lists.
    await service.update(
      actor,
      "draft-1",
      1,
      "subdivision.us.california",
      { type: "subdivision", parentKey: "country.france" },
      "req-1",
    );
    const stored = (written()?.entities as Record<string, unknown>[])[1];
    expect(stored?.config).toEqual({ includeInCountryCatalog: false });
    expect(stored?.recognitionStatus).toBe("not_applicable");
  });

  it("refuses to put a subdivision in the country catalog", async () => {
    const { service } = serviceWith({
      entities: [entity(), entity({ key: "subdivision.us.california" })],
    });
    await expect(
      service.update(
        actor,
        "draft-1",
        1,
        "subdivision.us.california",
        {
          type: "subdivision",
          parentKey: "country.france",
          includeInCountryCatalog: true,
        },
        "req-1",
      ),
    ).rejects.toMatchObject({
      response: { error: { code: "SUBDIVISION_IN_COUNTRY_CATALOG" } },
    });
  });

  it("writes the facts form into the override map", async () => {
    const { service, written } = serviceWith({ entities: [entity()] });
    await service.update(
      actor,
      "draft-1",
      1,
      "country.france",
      {
        facts: {
          capital: { en: "Paris", ru: "Париж" },
          motto: { en: "Liberty" },
          statehoodDate: "1850-09-09",
          population: { value: 39_500_000, observedAt: "2026-01-01" },
          area: { value: 423_970, unit: "km2" },
          languages: [{ en: "French" }],
        },
      },
      "req-1",
    );
    const stored = (written()?.entities as Record<string, unknown>[])[0];
    expect(stored?.overrides).toEqual({
      "facts.capital.en": "Paris",
      "facts.capital.ru": "Париж",
      "facts.motto.en": "Liberty",
      "facts.statehoodDate": "1850-09-09",
      "facts.population": { value: 39_500_000, observedAt: "2026-01-01" },
      "facts.area": { value: 423_970, unit: "km2" },
      "facts.languages": [{ en: "French" }],
    });
  });

  it("keeps the facts when only the other overrides are sent", async () => {
    const { service, written } = serviceWith({
      entities: [
        entity({
          overrides: {
            "facts.capital.en": "Paris",
            "names.ru.short": "Франция",
          },
        }),
      ],
    });
    // The console edits the two halves in separate forms and sends the map
    // the raw table holds; the facts it does not show must survive that.
    await service.update(
      actor,
      "draft-1",
      1,
      "country.france",
      { overrides: { "names.ru.short": "Франция" } },
      "req-1",
    );
    const stored = (written()?.entities as Record<string, unknown>[])[0];
    expect(stored?.overrides).toEqual({
      "facts.capital.en": "Paris",
      "names.ru.short": "Франция",
    });
  });

  it("reads the facts back out of the overrides, and not twice", async () => {
    const { service } = serviceWith({
      entities: [
        entity({
          overrides: {
            "facts.capital.en": "Paris",
            "facts.area": { value: 551_695, unit: "km2" },
            "names.ru.short": "Франция",
          },
        }),
      ],
    });
    const detail = await service.getOne("draft-1", "country.france");
    expect(detail.entity.facts).toEqual({
      capital: { en: "Paris" },
      area: { value: 551_695, unit: "km2" },
    });
    // What the facts form owns is not repeated in the raw override table.
    expect(detail.entity.overrides).toEqual({ "names.ru.short": "Франция" });
    expect(detail.entity.parentKey).toBeNull();
  });

  it("lists the parent and what is already drawn, in two queries", async () => {
    let geoCalls = 0;
    let assetCalls = 0;
    const document = {
      entities: [
        entity(),
        entity({
          key: "subdivision.us.california",
          type: "subdivision",
          parentKey: "country.france",
          config: { includeInCountryCatalog: false },
        }),
      ],
    };
    const drafts = {
      get: () => Promise.resolve({ document } as unknown as ContentDraft),
    } as unknown as AdminDraftsService;
    const database = {
      geoEntity: {
        findMany: () => {
          geoCalls += 1;
          return Promise.resolve([
            {
              contentKey: "country.france",
              names: [{ locale: "en", value: "France" }],
              assets: [{ assetType: "FLAG" }, { assetType: "COAT_OF_ARMS" }],
            },
          ]);
        },
      },
      draftAsset: {
        findMany: () => {
          assetCalls += 1;
          return Promise.resolve([
            {
              entityContentKey: "subdivision.us.california",
              assetType: "FLAG",
            },
          ]);
        },
      },
    } as unknown as PrismaService;
    const items = await new DraftEntitiesService(database, drafts).list(
      "draft-1",
    );
    expect(geoCalls).toBe(1);
    expect(assetCalls).toBe(1);
    expect(items[0]).toMatchObject({
      key: "country.france",
      parentKey: null,
      hasFlag: true,
      hasCoatOfArms: true,
      publishedName: "France",
    });
    // The state's flag was uploaded into the draft; its coat is still missing.
    expect(items[1]).toMatchObject({
      key: "subdivision.us.california",
      parentKey: "country.france",
      hasFlag: true,
      hasCoatOfArms: false,
    });
  });
});
