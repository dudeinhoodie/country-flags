import {
  assertAccessChangeIsAllowed,
  assertDeckCardsAreSound,
  cardIdentity,
  deckNeedsV3,
  previewCardIdsOf,
  previewCardsFromIds,
  promptAssetTypeOf,
  resolveDeckCards,
  withDeckDefaults,
} from "./deck-cards";
import type { EditorialDeck, MembershipContext } from "./deck-membership";

function entity(
  key: string,
  type = "country",
): MembershipContext["entities"][number] {
  return {
    key,
    type,
    status: "active",
    config: { includeInCountryCatalog: true },
  };
}

const context: MembershipContext = {
  entities: [
    entity("country.germany"),
    entity("country.france"),
    entity("subdivision.us.california", "subdivision"),
  ],
  relations: [],
};

function deck(overrides: Partial<EditorialDeck> = {}): EditorialDeck {
  return {
    key: "deck.sampler",
    kind: "curated",
    names: { en: { name: "Sampler", description: "A sampler." } },
    members: ["country.germany"],
    ...overrides,
  };
}

/**
 * ApiException carries its code in the typed error envelope rather than on
 * the exception, so the assertion reads what the console would be told.
 */
function codeOf(run: () => void): string {
  try {
    run();
  } catch (thrown) {
    const response = (
      thrown as { getResponse?: () => unknown }
    ).getResponse?.();
    return (
      (response as { error?: { code: string } } | undefined)?.error?.code ??
      "NOT_AN_API_EXCEPTION"
    );
  }
  return "NO_ERROR";
}

describe("resolveDeckCards", () => {
  it("keeps the editorial order of an explicit list", () => {
    const cards = resolveDeckCards(
      deck({
        defaultTemplateCode: "FLAG_TO_COUNTRY",
        defaultTemplateSchemaVersion: 1,
        members: ["country.france", "country.germany"],
      }),
      context,
    );
    expect(cards.map((card) => card.entityKey)).toEqual([
      "country.france",
      "country.germany",
    ]);
    expect(cards.map((card) => card.sortOrder)).toEqual([0, 1]);
  });

  it("reads one country twice as two cards, not one member listed twice", () => {
    const cards = resolveDeckCards(
      deck({
        members: [
          {
            entityKey: "country.germany",
            templateCode: "FLAG_TO_COUNTRY",
            templateSchemaVersion: 1,
          },
          {
            entityKey: "country.germany",
            templateCode: "COAT_OF_ARMS_TO_COUNTRY",
            templateSchemaVersion: 1,
          },
        ],
      }),
      context,
    );
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.assetType)).toEqual([
      "FLAG",
      "COAT_OF_ARMS",
    ]);
    expect(cards.every((card) => card.learningCardId === null)).toBe(true);
  });

  it("gives a bare key the deck's default template", () => {
    const cards = resolveDeckCards(
      deck({
        defaultTemplateCode: "COAT_OF_ARMS_TO_COUNTRY",
        defaultTemplateSchemaVersion: 1,
      }),
      context,
    );
    expect(cards[0]?.templateCode).toBe("COAT_OF_ARMS_TO_COUNTRY");
    expect(cards[0]?.assetType).toBe("COAT_OF_ARMS");
  });

  it("resolves the whole approved catalog for all-current", () => {
    const cards = resolveDeckCards(deck({ members: "all-current" }), context);
    expect(cards.map((card) => card.entityKey)).toEqual([
      "country.france",
      "country.germany",
    ]);
  });
});

describe("card identity", () => {
  it("names a card the way the publish gate names it", () => {
    expect(
      cardIdentity({
        entityKey: "country.germany",
        templateCode: "FLAG_TO_COUNTRY",
        templateSchemaVersion: 1,
      }),
    ).toBe("country.germany#FLAG_TO_COUNTRY@1");
  });

  it("says which drawing a template reads", () => {
    expect(promptAssetTypeOf("COAT_OF_ARMS_TO_COUNTRY")).toBe("COAT_OF_ARMS");
    expect(promptAssetTypeOf("NOT_A_TEMPLATE")).toBeNull();
  });
});

describe("previews", () => {
  it("writes a preview the way its member is written", () => {
    const subject = deck({
      defaultTemplateCode: "FLAG_TO_COUNTRY",
      defaultTemplateSchemaVersion: 1,
      members: ["country.germany", "country.france"],
    });
    expect(
      previewCardsFromIds(subject, ["country.france#FLAG_TO_COUNTRY@1"]),
    ).toEqual(["country.france"]);
  });

  it("round-trips ids through the deck's default template", () => {
    const subject = deck({
      defaultTemplateCode: "COAT_OF_ARMS_TO_COUNTRY",
      defaultTemplateSchemaVersion: 1,
      previewCards: ["country.germany"],
    });
    expect(previewCardIdsOf(subject)).toEqual([
      "country.germany#COAT_OF_ARMS_TO_COUNTRY@1",
    ]);
  });

  it("refuses a preview the deck does not hold", () => {
    expect(
      codeOf(() =>
        assertDeckCardsAreSound(
          deck({
            defaultTemplateCode: "FLAG_TO_COUNTRY",
            defaultTemplateSchemaVersion: 1,
            previewCards: ["country.france"],
          }),
          context,
        ),
      ),
    ).toBe("DECK_PREVIEW_NOT_MEMBER");
  });

  it("refuses more than three previews", () => {
    expect(
      codeOf(() =>
        assertDeckCardsAreSound(
          deck({
            defaultTemplateCode: "FLAG_TO_COUNTRY",
            defaultTemplateSchemaVersion: 1,
            members: ["a", "b", "c", "d"],
            previewCards: ["a", "b", "c", "d"],
          }),
          context,
        ),
      ),
    ).toBe("DECK_PREVIEW_TOO_MANY");
  });

  it("refuses an id that does not name a card", () => {
    expect(codeOf(() => previewCardsFromIds(deck(), ["not a card ref"]))).toBe(
      "DECK_PREVIEW_UNREADABLE",
    );
  });
});

describe("templates on the write path", () => {
  it("refuses a template the catalog does not build", () => {
    expect(
      codeOf(() =>
        assertDeckCardsAreSound(
          deck({
            members: [
              {
                entityKey: "country.germany",
                templateCode: "MADE_UP",
                templateSchemaVersion: 1,
              },
            ],
          }),
          context,
        ),
      ),
    ).toBe("DECK_TEMPLATE_UNKNOWN");
  });

  it("refuses a coat of arms asked of a subdivision", () => {
    expect(
      codeOf(() =>
        assertDeckCardsAreSound(
          deck({
            members: [
              {
                entityKey: "subdivision.us.california",
                templateCode: "COAT_OF_ARMS_TO_COUNTRY",
                templateSchemaVersion: 1,
              },
            ],
          }),
          context,
        ),
      ),
    ).toBe("DECK_TEMPLATE_SUBJECT_UNSUPPORTED");
  });

  it("teaches a state flag through the flag template", () => {
    expect(
      codeOf(() =>
        assertDeckCardsAreSound(
          deck({ members: ["subdivision.us.california"] }),
          context,
        ),
      ),
    ).toBe("NO_ERROR");
  });
});

describe("access", () => {
  it("needs an entitlement on a paid deck", () => {
    expect(
      codeOf(() =>
        assertDeckCardsAreSound(
          deck({ access: { model: "ENTITLEMENT" } }),
          context,
        ),
      ),
    ).toBe("DECK_ACCESS_ENTITLEMENT_MISSING");
  });

  it("refuses an entitlement key that is not one", () => {
    expect(
      codeOf(() =>
        assertDeckCardsAreSound(
          deck({
            access: {
              model: "ENTITLEMENT",
              requiredEntitlementKey: "European Coats",
            },
          }),
          context,
        ),
      ),
    ).toBe("DECK_ACCESS_ENTITLEMENT_INVALID");
  });

  it("refuses an entitlement on a free deck", () => {
    expect(
      codeOf(() =>
        assertDeckCardsAreSound(
          deck({
            access: {
              model: "FREE",
              requiredEntitlementKey: "deck.european_coats",
            },
          }),
          context,
        ),
      ),
    ).toBe("DECK_ACCESS_ENTITLEMENT_UNUSED");
  });

  it("refuses turning a published free deck paid", () => {
    expect(
      codeOf(() =>
        assertAccessChangeIsAllowed(
          "deck.europe",
          { model: "FREE" },
          {
            model: "ENTITLEMENT",
            requiredEntitlementKey: "deck.europe",
          },
        ),
      ),
    ).toBe("DECK_ACCESS_TIGHTENED");
  });

  it("refuses renaming the entitlement of a published paid deck", () => {
    expect(
      codeOf(() =>
        assertAccessChangeIsAllowed(
          "deck.european_coats",
          {
            model: "ENTITLEMENT",
            requiredEntitlementKey: "deck.europe_coats",
          },
          {
            model: "ENTITLEMENT",
            requiredEntitlementKey: "deck.europe_coats_v2",
          },
        ),
      ),
    ).toBe("DECK_ENTITLEMENT_CHANGED");
  });

  it("lets a deck the release never carried be paid from the start", () => {
    expect(
      codeOf(() =>
        assertAccessChangeIsAllowed("deck.us_state_flags", undefined, {
          model: "ENTITLEMENT",
          requiredEntitlementKey: "deck.us_state_flags",
        }),
      ),
    ).toBe("NO_ERROR");
  });

  it("lets a published paid deck become free", () => {
    expect(
      codeOf(() =>
        assertAccessChangeIsAllowed(
          "deck.european_coats",
          {
            model: "ENTITLEMENT",
            requiredEntitlementKey: "deck.europe_coats",
          },
          { model: "FREE" },
        ),
      ),
    ).toBe("NO_ERROR");
  });
});

describe("schema version", () => {
  it("leaves a deck of bare country keys where it was written", () => {
    expect(deckNeedsV3(deck())).toBe(false);
    expect(withDeckDefaults(deck()).defaultTemplateCode).toBeUndefined();
  });

  it("moves a deck that names a template, an access model or a preview", () => {
    expect(deckNeedsV3(deck({ defaultTemplateCode: "FLAG_TO_COUNTRY" }))).toBe(
      true,
    );
    expect(deckNeedsV3(deck({ access: { model: "FREE" } }))).toBe(true);
    expect(deckNeedsV3(deck({ previewCards: ["country.germany"] }))).toBe(true);
    expect(
      deckNeedsV3(
        deck({
          members: [
            {
              entityKey: "country.germany",
              templateCode: "FLAG_TO_COUNTRY",
              templateSchemaVersion: 1,
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("fills the default in for a v2-shaped deck once the document is v3", () => {
    // The document decides too: v3 requires the default of every deck it
    // holds, including one that would have been happy in v2.
    const filled = withDeckDefaults(deck(), true);
    expect(filled.defaultTemplateCode).toBe("FLAG_TO_COUNTRY");
    expect(filled.defaultTemplateSchemaVersion).toBe(1);
  });

  it("fills in the default template a v3 deck must carry", () => {
    const filled = withDeckDefaults(deck({ access: { model: "FREE" } }));
    expect(filled.defaultTemplateCode).toBe("FLAG_TO_COUNTRY");
    expect(filled.defaultTemplateSchemaVersion).toBe(1);
  });
});
