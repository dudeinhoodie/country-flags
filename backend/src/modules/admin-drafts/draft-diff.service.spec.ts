import { DraftDiffService } from "./draft-diff.service";
import type { MembershipContext } from "./deck-membership";
import type { PrismaService } from "../../infrastructure/database/prisma.service";

const context: MembershipContext = {
  entities: [
    { key: "country.france", status: "active", includeInCountryCatalog: true },
    { key: "country.japan", status: "active", includeInCountryCatalog: true },
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
): DraftDiffService {
  const database = {
    deck: { findMany: () => Promise.resolve(published) },
    draftAsset: { findMany: () => Promise.resolve(assets) },
  } as unknown as PrismaService;
  return new DraftDiffService(database);
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
    expect(removed?.deckKey).toBe("EUROPE");

    const added = await serviceWith([]).diff(draft, context);
    expect(added.decks[0]?.change).toBe("added");
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
