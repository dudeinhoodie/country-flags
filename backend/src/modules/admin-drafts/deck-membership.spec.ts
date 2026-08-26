import {
  assertDeckIsSound,
  currentEntityKeys,
  learnableEntityKeys,
  membersMode,
  resolveDeckMembers,
} from "./deck-membership";
import type { EditorialDeck, MembershipContext } from "./deck-membership";

/**
 * ApiException carries its text in the typed error envelope, not in
 * Error#message, so assertions read the envelope the client would get.
 */
function errorOf(action: () => unknown): { code: string; message: string } {
  try {
    action();
  } catch (thrown) {
    const response = (
      thrown as { getResponse?: () => unknown }
    ).getResponse?.();
    const envelope = (response as { error?: { code: string; message: string } })
      ?.error;
    if (envelope !== undefined) {
      return envelope;
    }
    throw thrown;
  }
  throw new Error("expected the call to throw");
}

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
    {
      key: "country.spain",
      type: "country",
      status: "active",
      config: { includeInCountryCatalog: true },
    },
    // Not learnable any more: no deck may pick it up.
    {
      key: "country.ussr",
      type: "country",
      status: "historical",
      config: { includeInCountryCatalog: true },
    },
    // Hidden from the all-countries deck, still learnable: taxonomy and
    // explicit decks keep it (ADR-015).
    {
      key: "territory.aland",
      type: "territory",
      status: "active",
      config: { includeInCountryCatalog: false },
    },
    {
      key: "region.europe",
      type: "region",
      status: "active",
      config: { includeInCountryCatalog: false },
    },
    {
      key: "region.asia",
      type: "region",
      status: "active",
      config: { includeInCountryCatalog: false },
    },
    {
      key: "subregion.iberia",
      type: "subregion",
      status: "active",
      config: { includeInCountryCatalog: false },
    },
  ],
  relations: [
    {
      parentKey: "region.europe",
      childKey: "subregion.iberia",
      relationType: "contains",
    },
    {
      parentKey: "subregion.iberia",
      childKey: "country.spain",
      relationType: "contains",
    },
    {
      parentKey: "region.europe",
      childKey: "country.france",
      relationType: "contains",
    },
    {
      parentKey: "region.asia",
      childKey: "country.japan",
      relationType: "contains",
    },
    // Association is proximity, not membership: Japan must not join Europe.
    {
      parentKey: "region.europe",
      childKey: "country.japan",
      relationType: "associated_with",
    },
  ],
};

function deck(overrides: Partial<EditorialDeck>): EditorialDeck {
  return {
    key: "deck.test",
    kind: "curated",
    names: {
      ru: { name: "Тест", description: "Описание" },
      en: { name: "Test", description: "Description" },
    },
    members: "all-current",
    ...overrides,
  };
}

describe("learnableEntityKeys", () => {
  it("keeps every active country, territory and area, whatever the listing toggle says", () => {
    expect(learnableEntityKeys(context.entities)).toEqual([
      "country.france",
      "country.japan",
      "country.spain",
      "territory.aland",
    ]);
  });
});

describe("currentEntityKeys", () => {
  it("narrows the learnable pool by the listing toggle, sorted", () => {
    expect(currentEntityKeys(context.entities)).toEqual([
      "country.france",
      "country.japan",
      "country.spain",
    ]);
  });
});

describe("membersMode", () => {
  it("names each of the three shapes", () => {
    expect(membersMode("all-current")).toBe("all-current");
    expect(membersMode(["country.france"])).toBe("explicit");
    expect(membersMode({ taxonomy: "region.europe" })).toBe("taxonomy");
  });
});

describe("resolveDeckMembers", () => {
  it("resolves all-current to the approved catalog", () => {
    expect(resolveDeckMembers(deck({}), context)).toEqual([
      "country.france",
      "country.japan",
      "country.spain",
    ]);
  });

  it("sorts an explicit list the way the build does", () => {
    expect(
      resolveDeckMembers(
        deck({ members: ["country.japan", "country.france"] }),
        context,
      ),
    ).toEqual(["country.france", "country.japan"]);
  });

  it("walks a taxonomy node to any depth and skips the root", () => {
    expect(
      resolveDeckMembers(
        deck({ kind: "taxonomy", members: { taxonomy: "region.europe" } }),
        context,
      ),
    ).toEqual(["country.france", "country.spain"]);
  });

  it("follows contains only, never association", () => {
    const members = resolveDeckMembers(
      deck({ kind: "taxonomy", members: { taxonomy: "region.europe" } }),
      context,
    );
    expect(members).not.toContain("country.japan");
  });

  it("refuses a taxonomy node the catalog does not classify", () => {
    const error = errorOf(() =>
      resolveDeckMembers(
        deck({ kind: "taxonomy", members: { taxonomy: "region.oceania" } }),
        context,
      ),
    );
    expect(error.code).toBe("DECK_TAXONOMY_EMPTY");
    expect(error.message).toMatch(/contains nothing/);
  });

  it("keeps an entity hidden from the all-countries deck in a taxonomy deck", () => {
    const hiddenIsland: MembershipContext = {
      entities: context.entities,
      relations: [
        {
          parentKey: "region.nordics",
          childKey: "territory.aland",
          relationType: "contains",
        },
      ],
    };
    expect(
      resolveDeckMembers(
        deck({ kind: "taxonomy", members: { taxonomy: "region.nordics" } }),
        hiddenIsland,
      ),
    ).toEqual(["territory.aland"]);
  });

  it("refuses a node whose entities are all unpublishable", () => {
    const isolated: MembershipContext = {
      entities: context.entities,
      relations: [
        {
          parentKey: "region.nowhere",
          childKey: "country.ussr",
          relationType: "contains",
        },
      ],
    };
    expect(
      errorOf(() =>
        resolveDeckMembers(
          deck({ kind: "taxonomy", members: { taxonomy: "region.nowhere" } }),
          isolated,
        ),
      ).message,
    ).toMatch(/no entity the catalog publishes/);
  });
});

describe("assertDeckIsSound", () => {
  const locales = ["ru", "en"];

  it("accepts a well-formed deck", () => {
    expect(() => assertDeckIsSound(deck({}), context, locales)).not.toThrow();
  });

  it("requires every supported locale", () => {
    const error = errorOf(() =>
      assertDeckIsSound(
        deck({ names: { ru: { name: "Тест", description: "Описание" } } }),
        context,
        locales,
      ),
    );
    expect(error.code).toBe("DECK_LOCALIZATION_MISSING");
    expect(error.message).toMatch(/missing: en/);
  });

  it("rejects a blank localized name", () => {
    expect(
      errorOf(() =>
        assertDeckIsSound(
          deck({
            names: {
              ru: { name: "  ", description: "Описание" },
              en: { name: "Test", description: "Description" },
            },
          }),
          context,
          locales,
        ),
      ).message,
    ).toMatch(/every supported locale/);
  });

  it("rejects duplicate members", () => {
    const error = errorOf(() =>
      assertDeckIsSound(
        deck({ members: ["country.france", "country.france"] }),
        context,
        locales,
      ),
    );
    expect(error.code).toBe("DECK_MEMBER_DUPLICATE");
    expect(error.message).toMatch(/more than once/);
  });

  it("rejects entities the catalog does not carry", () => {
    const error = errorOf(() =>
      assertDeckIsSound(
        deck({ members: ["country.atlantis"] }),
        context,
        locales,
      ),
    );
    expect(error.code).toBe("DECK_MEMBER_UNKNOWN");
    expect(error.message).toMatch(/does not carry/);
  });

  it("rejects an explicit deck with no members", () => {
    expect(
      errorOf(() => assertDeckIsSound(deck({ members: [] }), context, locales))
        .message,
    ).toMatch(/at least one entity/);
  });
});
