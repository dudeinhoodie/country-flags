import { DraftDiffService } from "./draft-diff.service";
import type { CatalogSourceService } from "./catalog-source.service";
import type { MembershipContext } from "./deck-membership";
import type { PrismaService } from "../../infrastructure/database/prisma.service";

const context: MembershipContext = {
  entities: [
    {
      key: "country.france",
      type: "country",
      status: "active",
      config: { includeInCountryCatalog: true },
    },
    {
      key: "country.japan",
      type: "country",
      status: "active",
      config: { includeInCountryCatalog: true },
    },
  ],
  relations: [],
};

function deck(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    key: "deck.all",
    kind: "curated",
    names: {
      ru: { name: "Все страны", description: "Все страны" },
      en: { name: "All countries", description: "All countries" },
    },
    members: "all-current",
    ...overrides,
  };
}

function publishedDeck(overrides: Record<string, unknown> = {}): {
  code: string;
  localizations: { locale: string; name: string; description: string }[];
  _count: { cards: number };
} {
  return {
    code: "ALL",
    localizations: [
      { locale: "ru", name: "Все страны", description: "Все страны" },
      { locale: "en", name: "All countries", description: "All countries" },
    ],
    _count: { cards: 2 },
    ...overrides,
  };
}

function serviceWith(
  published: ReturnType<typeof publishedDeck>[],
  assets: unknown[] = [],
  baseEntities: Record<
    string,
    unknown
  >[] = context.entities as unknown as Record<string, unknown>[],
): DraftDiffService {
  const database = {
    deck: { findMany: () => Promise.resolve(published) },
    draftAsset: { findMany: () => Promise.resolve(assets) },
  } as unknown as PrismaService;
  const catalogSource = {
    read: () => ({ document: { entities: baseEntities }, commit: "base" }),
  } as unknown as CatalogSourceService;
  return new DraftDiffService(database, catalogSource);
}

const draft = {
  id: "11111111-1111-4111-8111-111111111111",
  baseContentVersion: "fixture-v1",
  document: { entities: context.entities, decks: [deck()] },
};

describe("DraftDiffService", () => {
  it("reports nothing to release when the draft matches the active version", async () => {
    const diff = await serviceWith([publishedDeck()]).diff(draft, context);
    expect(diff.isEmpty).toBe(true);
    expect(diff.decks).toEqual([]);
    expect(diff.assets).toEqual([]);
  });

  it("states a rename in the domain's words, not as a patch", async () => {
    const renamed = {
      ...draft,
      document: {
        entities: context.entities,
        decks: [
          deck({
            names: {
              ru: { name: "Все страны мира", description: "Все страны" },
              en: { name: "All countries", description: "All countries" },
            },
          }),
        ],
      },
    };
    const diff = await serviceWith([publishedDeck()]).diff(renamed, context);
    expect(diff.isEmpty).toBe(false);
    expect(diff.decks[0]?.change).toBe("changed");
    expect(diff.decks[0]?.details.join(" ")).toContain("Все страны мира");
  });

  it("counts a membership change", async () => {
    const diff = await serviceWith([
      publishedDeck({ _count: { cards: 5 } }),
    ]).diff(draft, context);
    expect(diff.decks[0]?.details.join(" ")).toContain("5 → 2");
  });

  it("names a deck the draft drops and one it adds", async () => {
    const diff = await serviceWith([
      publishedDeck(),
      publishedDeck({ code: "EUROPE", _count: { cards: 1 } }),
    ]).diff(draft, context);
    const removed = diff.decks.find((entry) => entry.change === "removed");
    // A deck the draft no longer carries has no editorial key left, only
    // the code the release published it under.
    expect(removed?.publishedCode).toBe("EUROPE");
    expect(removed?.deckKey).toBeNull();

    const added = await serviceWith([]).diff(draft, context);
    expect(added.decks[0]?.change).toBe("added");
    expect(added.decks[0]?.deckKey).toBe("deck.all");
    expect(added.decks[0]?.publishedCode).toBeNull();
  });

  it("says what an entity edit changed, override by override", async () => {
    const edited = {
      ...draft,
      document: {
        entities: [
          {
            key: "country.france",
            status: "hidden",
            config: { includeInCountryCatalog: true },
            overrides: { "names.ru.short": "Франция (ред.)" },
          },
          context.entities[1],
        ],
        decks: [deck()],
      },
    };
    const diff = await serviceWith([publishedDeck()]).diff(edited, context);
    expect(diff.isEmpty).toBe(false);
    const entry = diff.entities.find(
      (item) => item.entityKey === "country.france",
    );
    expect(entry?.details.join(" ")).toContain("status: active → hidden");
    expect(entry?.details.join(" ")).toContain(
      'override names.ru.short set to "Франция (ред.)"',
    );
    // The untouched entity stays out of the report.
    expect(diff.entities).toHaveLength(1);
  });

  it("reports a removed override rather than hiding the rollback", async () => {
    const base = [
      {
        key: "country.france",
        status: "active",
        config: { includeInCountryCatalog: true },
        overrides: { "names.en.short": "Pinned" },
      },
      context.entities[1] as unknown as Record<string, unknown>,
    ];
    const reverted = {
      ...draft,
      document: {
        entities: [
          {
            key: "country.france",
            status: "active",
            config: { includeInCountryCatalog: true },
          },
          context.entities[1],
        ],
        decks: [deck()],
      },
    };
    const diff = await serviceWith([publishedDeck()], [], base).diff(
      reverted,
      context,
    );
    expect(diff.entities[0]?.details.join(" ")).toContain(
      "override names.en.short removed",
    );
  });

  it("lists replaced drawings with the reason a human gave", async () => {
    const diff = await serviceWith(
      [publishedDeck()],
      [
        {
          entityContentKey: "country.france",
          assetType: "FLAG",
          replacementReason: "The upstream shade was wrong.",
        },
      ],
    ).diff(draft, context);
    expect(diff.isEmpty).toBe(false);
    expect(diff.assets[0]?.reason).toBe("The upstream shade was wrong.");
  });
});
