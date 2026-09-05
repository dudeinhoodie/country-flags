import {
  DraftValidationService,
  withFindingRoutes,
} from "./draft-validation.service";
import type { MembershipContext } from "./deck-membership";

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
    {
      key: "region.europe",
      type: "region",
      status: "active",
      config: { includeInCountryCatalog: false },
    },
  ],
  relations: [
    {
      parentKey: "region.europe",
      childKey: "country.france",
      relationType: "contains",
    },
    {
      parentKey: "region.europe",
      childKey: "country.spain",
      relationType: "contains",
    },
  ],
};

function document(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 2,
    defaultLocale: "ru",
    supportedLocales: ["ru", "en"],
    entities: context.entities.map((entity) => ({
      ...entity,
      recognitionStatus: "un_member",
    })),
    additionalRelations: [],
    decks: [
      {
        key: "deck.all",
        kind: "curated",
        names: {
          ru: { name: "Все", description: "Все страны" },
          en: { name: "All", description: "All countries" },
        },
        members: "all-current",
      },
    ],
    ...overrides,
  };
}

describe("DraftValidationService", () => {
  const service = new DraftValidationService();

  it("passes a sound catalog with nothing blocking", () => {
    const report = service.validate(document(), context, []);
    expect(report.blocking).toBe(0);
    expect(report.validatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("blocks a deck missing a supported locale", () => {
    const report = service.validate(
      document({
        decks: [
          {
            key: "deck.all",
            kind: "curated",
            names: { ru: { name: "Все", description: "Все страны" } },
            members: "all-current",
          },
        ],
      }),
      context,
      [],
    );
    expect(report.blocking).toBeGreaterThan(0);
    expect(
      report.findings.some(
        (finding) => finding.code === "DECK_LOCALIZATION_MISSING",
      ),
    ).toBe(true);
  });

  it("warns rather than blocks when only the build can resolve a node", () => {
    const report = service.validate(
      document({
        decks: [
          {
            key: "deck.nowhere",
            kind: "taxonomy",
            names: {
              ru: { name: "Нигде", description: "Пусто" },
              en: { name: "Nowhere", description: "Empty" },
            },
            members: { taxonomy: "region.atlantis" },
          },
        ],
      }),
      context,
      [],
    );
    expect(
      report.findings.some(
        (finding) => finding.code === "DECK_UNRESOLVABLE_HERE",
      ),
    ).toBe(true);
    // The release build classifies against freshly merged sources, so a
    // node this preview cannot walk must not stop legitimate work.
    expect(report.blocking).toBe(0);
    expect(report.warnings).toBeGreaterThan(0);
  });

  it("warns about explicit members that carry no card, and unknown ones", () => {
    const report = service.validate(
      document({
        decks: [
          {
            key: "deck.mixed",
            kind: "curated",
            names: {
              ru: { name: "Смесь", description: "Разное" },
              en: { name: "Mixed", description: "Assorted" },
            },
            members: ["country.france", "region.europe", "country.atlantis"],
          },
        ],
      }),
      context,
      [],
    );
    // Editorial latitude, not a broken build: the deck publishes without
    // the cardless members, and the editor should know before proposing.
    expect(report.blocking).toBe(0);
    expect(
      report.findings.some(
        (finding) =>
          finding.code === "MEMBER_NOT_LEARNABLE" &&
          finding.message.includes("region.europe"),
      ),
    ).toBe(true);
    expect(
      report.findings.some(
        (finding) =>
          finding.code === "MEMBER_UNKNOWN" &&
          finding.message.includes("country.atlantis"),
      ),
    ).toBe(true);
  });

  it("blocks duplicate entities and duplicate decks", () => {
    const doubled = document({
      entities: [
        ...context.entities.map((entity) => ({
          ...entity,
          recognitionStatus: "un_member",
        })),
        {
          key: "country.france",
          type: "country",
          status: "active",
          config: { includeInCountryCatalog: true },
          recognitionStatus: "un_member",
        },
      ],
    });
    const report = service.validate(doubled, context, []);
    expect(
      report.findings.some((finding) => finding.code === "ENTITY_DUPLICATE"),
    ).toBe(true);
  });

  it("blocks an upload with incomplete provenance or an unknown entity", () => {
    const report = service.validate(document(), context, [
      {
        entityContentKey: "country.france",
        licenseName: null,
        sourceUrl: "https://example.test/a.svg",
        replacementReason: "Because",
      },
      {
        entityContentKey: "country.atlantis",
        licenseName: "CC0-1.0",
        sourceUrl: "https://example.test/b.svg",
        replacementReason: "Because",
      },
    ]);
    const codes = report.findings.map((finding) => finding.code);
    expect(codes).toContain("ASSET_PROVENANCE_INCOMPLETE");
    expect(codes).toContain("ASSET_UNKNOWN_ENTITY");
    expect(report.blocking).toBe(2);
  });

  it("warns without blocking when a relation names an unknown entity", () => {
    const report = service.validate(
      document({
        additionalRelations: [
          {
            parentKey: "region.europe",
            childKey: "country.atlantis",
            taxonomyKey: "taxonomy.editorial.v1",
            relationType: "contains",
            primary: true,
          },
        ],
      }),
      context,
      [],
    );
    expect(report.blocking).toBe(0);
    expect(report.warnings).toBeGreaterThan(0);
    expect(
      report.findings.some(
        (finding) => finding.code === "RELATION_UNKNOWN_ENTITY",
      ),
    ).toBe(true);
  });

  describe("subdivisions", () => {
    const california = {
      key: "subdivision.us.california",
      type: "subdivision",
      status: "active",
      config: { includeInCountryCatalog: false },
      recognitionStatus: "not_applicable",
      parentKey: "country.france",
    };

    const withState = (entity: Record<string, unknown> = california): unknown =>
      document({
        entities: [
          ...context.entities.map((known) => ({
            ...known,
            recognitionStatus: "un_member",
          })),
          entity,
        ],
      });

    const codes = (report: { findings: { code: string }[] }): string[] =>
      report.findings.map((finding) => finding.code);

    it("accepts a state that belongs to a country", () => {
      const report = service.validate(withState(), context, []);
      expect(codes(report)).not.toContain("SUBDIVISION_PARENT_REQUIRED");
      expect(codes(report)).not.toContain("SUBDIVISION_PARENT_INVALID");
    });

    it("blocks a state with no country above it", () => {
      const orphan: Record<string, unknown> = { ...california };
      delete orphan.parentKey;
      const report = service.validate(withState(orphan), context, []);
      expect(codes(report)).toContain("SUBDIVISION_PARENT_REQUIRED");
      expect(report.blocking).toBeGreaterThan(0);
    });

    it("blocks a state whose parent is not a country or territory", () => {
      const report = service.validate(
        withState({ ...california, parentKey: "region.europe" }),
        context,
        [],
      );
      expect(codes(report)).toContain("SUBDIVISION_PARENT_INVALID");
    });

    it("blocks a state the catalog cannot find a parent for", () => {
      const report = service.validate(
        withState({ ...california, parentKey: "country.atlantis" }),
        context,
        [],
      );
      expect(codes(report)).toContain("SUBDIVISION_PARENT_INVALID");
    });

    it("blocks a state listed among the countries", () => {
      const report = service.validate(
        withState({
          ...california,
          config: { includeInCountryCatalog: true },
        }),
        context,
        [],
      );
      expect(codes(report)).toContain("SUBDIVISION_IN_COUNTRY_CATALOG");
    });

    it("blocks a country given an administrative parent", () => {
      const report = service.validate(
        document({
          entities: context.entities.map((known) => ({
            ...known,
            recognitionStatus: "un_member",
            ...(known.key === "country.japan"
              ? { parentKey: "country.france" }
              : {}),
          })),
        }),
        context,
        [],
      );
      expect(codes(report)).toContain("SUBDIVISION_PARENT_INVALID");
    });

    it("blocks administrative parents that form a cycle", () => {
      const report = service.validate(
        document({
          entities: [
            ...context.entities.map((known) => ({
              ...known,
              recognitionStatus: "un_member",
            })),
            { ...california, parentKey: "subdivision.us.north" },
            {
              ...california,
              key: "subdivision.us.north",
              parentKey: "subdivision.us.california",
            },
          ],
        }),
        context,
        [],
      );
      expect(codes(report)).toContain("ADMINISTRATIVE_RELATION_CYCLE");
    });
  });

  describe("cards a deck asks for", () => {
    const codes = (report: { findings: { code: string }[] }): string[] =>
      report.findings.map((finding) => finding.code);

    const deckHolding = (members: unknown[], extra = {}): unknown =>
      document({
        decks: [
          {
            key: "deck.symbols",
            kind: "curated",
            names: {
              ru: { name: "Символы", description: "Оба символа" },
              en: { name: "Symbols", description: "Both symbols" },
            },
            defaultTemplateCode: "FLAG_TO_COUNTRY",
            defaultTemplateSchemaVersion: 1,
            members,
            ...extra,
          },
        ],
      });

    const coatOf = (entityKey: string): unknown => ({
      entityKey,
      templateCode: "COAT_OF_ARMS_TO_COUNTRY",
      templateSchemaVersion: 1,
    });

    it("accepts one entity taught through two templates", () => {
      const report = service.validate(
        deckHolding(["country.france", coatOf("country.france")]),
        context,
        [
          {
            entityContentKey: "country.france",
            assetType: "coat_of_arms",
            licenseName: "Public domain",
            sourceUrl: "https://example.invalid/coat.svg",
            replacementReason: "Verified official artwork",
          },
        ],
      );
      expect(codes(report)).not.toContain("DECK_CARD_DUPLICATE");
      expect(codes(report)).not.toContain("CARD_TEMPLATE_ASSET_MISSING");
    });

    it("blocks the same card listed twice", () => {
      const report = service.validate(
        deckHolding([
          "country.france",
          {
            entityKey: "country.france",
            templateCode: "FLAG_TO_COUNTRY",
            templateSchemaVersion: 1,
          },
        ]),
        context,
        [],
      );
      expect(codes(report)).toContain("DECK_CARD_DUPLICATE");
    });

    it("blocks a coat of arms nobody uploaded", () => {
      const report = service.validate(
        deckHolding([coatOf("country.france")]),
        context,
        [],
      );
      expect(codes(report)).toContain("CARD_TEMPLATE_ASSET_MISSING");
    });

    it("blocks a template no release publishes", () => {
      const report = service.validate(
        deckHolding([
          {
            entityKey: "country.france",
            templateCode: "MAP_TO_COUNTRY",
            templateSchemaVersion: 1,
          },
        ]),
        context,
        [],
      );
      expect(codes(report)).toContain("CARD_TEMPLATE_UNKNOWN");
    });

    it("blocks a coat of arms asked of a state", () => {
      const state = {
        key: "subdivision.us.california",
        type: "subdivision",
        status: "active",
        config: { includeInCountryCatalog: false },
        recognitionStatus: "not_applicable",
        parentKey: "country.france",
      };
      const report = service.validate(
        document({
          entities: [
            ...context.entities.map((known) => ({
              ...known,
              recognitionStatus: "un_member",
            })),
            state,
          ],
          decks: [
            {
              key: "deck.symbols",
              kind: "curated",
              names: {
                ru: { name: "Символы", description: "Оба символа" },
                en: { name: "Symbols", description: "Both symbols" },
              },
              defaultTemplateCode: "FLAG_TO_COUNTRY",
              defaultTemplateSchemaVersion: 1,
              members: [coatOf("subdivision.us.california")],
            },
          ],
        }),
        context,
        [
          {
            entityContentKey: "subdivision.us.california",
            assetType: "coat_of_arms",
            licenseName: "Public domain",
            sourceUrl: "https://example.invalid/coat.svg",
            replacementReason: "Uploaded by mistake",
          },
        ],
      );
      expect(codes(report)).toContain("CARD_TEMPLATE_SUBJECT_KIND_UNSUPPORTED");
    });

    it("blocks a preview the deck does not hold", () => {
      const report = service.validate(
        deckHolding(["country.france"], {
          previewCards: [coatOf("country.japan")],
        }),
        context,
        [],
      );
      expect(codes(report)).toContain("DECK_PREVIEW_NOT_MEMBER");
    });

    it("blocks a locked deck previewing more than three cards", () => {
      const report = service.validate(
        deckHolding(["country.france", "country.japan", "country.spain"], {
          previewCards: [
            "country.france",
            "country.japan",
            "country.spain",
            "country.france",
          ],
        }),
        context,
        [],
      );
      expect(codes(report)).toContain("DECK_PREVIEW_NOT_PUBLIC");
    });
  });

  describe("access", () => {
    const codes = (report: { findings: { code: string }[] }): string[] =>
      report.findings.map((finding) => finding.code);

    const paidDeck = (
      access: Record<string, unknown> | undefined,
      key = "deck.all",
    ): unknown =>
      document({
        decks: [
          {
            key,
            kind: "curated",
            names: {
              ru: { name: "Все", description: "Все страны" },
              en: { name: "All", description: "All countries" },
            },
            members: "all-current",
            ...(access === undefined ? {} : { access }),
          },
        ],
      });

    it("blocks a paid deck with no entitlement to sell", () => {
      const report = service.validate(
        paidDeck({ model: "ENTITLEMENT" }),
        context,
        [],
      );
      expect(codes(report)).toContain("DECK_ACCESS_ENTITLEMENT_MISSING");
    });

    it("blocks a free deck that still names an entitlement", () => {
      const report = service.validate(
        paidDeck({
          model: "FREE",
          requiredEntitlementKey: "deck.europe_coats",
        }),
        context,
        [],
      );
      expect(codes(report)).toContain("DECK_ACCESS_ENTITLEMENT_UNUSED");
    });

    it("blocks turning a published free deck into a paid one", () => {
      const report = service.validate(
        paidDeck({
          model: "ENTITLEMENT",
          requiredEntitlementKey: "deck.europe_coats",
        }),
        context,
        [],
        [
          {
            code: "ALL",
            accessModel: "FREE",
            requiredEntitlementKey: null,
          },
        ],
      );
      expect(codes(report)).toContain("DECK_ACCESS_TIGHTENED");
    });

    it("blocks changing the entitlement a published deck is sold against", () => {
      const report = service.validate(
        paidDeck({
          model: "ENTITLEMENT",
          requiredEntitlementKey: "deck.something_else",
        }),
        context,
        [],
        [
          {
            code: "ALL",
            accessModel: "ENTITLEMENT",
            requiredEntitlementKey: "deck.europe_coats",
          },
        ],
      );
      expect(codes(report)).toContain("DECK_ENTITLEMENT_CHANGED");
    });

    it("warns rather than blocks when a paid deck becomes free", () => {
      const report = service.validate(
        paidDeck({ model: "FREE" }),
        context,
        [],
        [
          {
            code: "ALL",
            accessModel: "ENTITLEMENT",
            requiredEntitlementKey: "deck.europe_coats",
          },
        ],
      );
      const relaxed = report.findings.find(
        (finding) => finding.code === "DECK_ACCESS_RELAXED",
      );
      expect(relaxed?.level).toBe("warning");
    });

    it("blocks dropping a paid deck somebody owns", () => {
      const report = service.validate(
        document(),
        context,
        [],
        [
          {
            code: "EUROPEAN_COATS",
            accessModel: "ENTITLEMENT",
            requiredEntitlementKey: "deck.europe_coats",
          },
        ],
      );
      expect(codes(report)).toContain("PAID_DECK_REMOVED");
    });
  });

  describe("addressable findings", () => {
    it("points a missing parent at the entity's own field", () => {
      const report = service.validate(
        document({
          entities: [
            ...context.entities.map((entry) => ({
              ...entry,
              recognitionStatus: "un_member",
            })),
            {
              key: "subdivision.us.california",
              type: "subdivision",
              status: "active",
              recognitionStatus: "not_applicable",
              config: { includeInCountryCatalog: false },
            },
          ],
        }),
        context,
        [],
      );

      const finding = report.findings.find(
        (entry) => entry.code === "SUBDIVISION_PARENT_REQUIRED",
      );
      expect(finding?.target).toEqual({
        objectType: "entity",
        objectKey: "subdivision.us.california",
        tab: "overview",
        field: "/parentKey",
      });
      // The identity and the subject are the same object, always.
      expect(finding?.subject).toBe(finding?.target.objectKey);
    });

    it("points a missing deck locale at the name in that locale", () => {
      const report = service.validate(
        document({
          decks: [
            {
              key: "deck.all",
              kind: "curated",
              names: { ru: { name: "Все", description: "Все страны" } },
              members: "all-current",
            },
          ],
        }),
        context,
        [],
      );

      const finding = report.findings.find(
        (entry) => entry.code === "DECK_LOCALIZATION_MISSING",
      );
      expect(finding?.target).toEqual({
        objectType: "deck",
        objectKey: "deck.all",
        tab: "details",
        field: "/names/en/name",
      });
    });

    it("points a member's mistake at the row it is in", () => {
      const report = service.validate(
        document({
          decks: [
            {
              key: "deck.coats",
              kind: "curated",
              names: {
                ru: { name: "Гербы", description: "Гербы" },
                en: { name: "Coats", description: "Coats" },
              },
              members: ["country.france", "country.japan"],
              defaultTemplateCode: "COAT_OF_ARMS_TO_COUNTRY",
              defaultTemplateSchemaVersion: 1,
            },
          ],
        }),
        context,
        [
          {
            entityContentKey: "country.france",
            assetType: "coat_of_arms",
            licenseName: "CC0",
            sourceUrl: "https://example.test/coat.svg",
            replacementReason: "upstream drawing is wrong",
          },
        ],
      );

      // France has a coat in this draft; Japan is the second row and has none.
      const finding = report.findings.find(
        (entry) => entry.code === "CARD_TEMPLATE_ASSET_MISSING",
      );
      expect(finding?.target.field).toBe("/members/1");
      expect(finding?.target.tab).toBe("content");
    });

    it("points an access mistake at the access tab", () => {
      const report = service.validate(
        document({
          decks: [
            {
              key: "deck.all",
              kind: "curated",
              names: {
                ru: { name: "Все", description: "Все страны" },
                en: { name: "All", description: "All countries" },
              },
              members: "all-current",
              access: { model: "ENTITLEMENT", requiredEntitlementKey: "" },
            },
          ],
        }),
        context,
        [],
      );

      const finding = report.findings.find(
        (entry) => entry.code === "DECK_ACCESS_ENTITLEMENT_MISSING",
      );
      expect(finding?.target.tab).toBe("access");
      expect(finding?.target.field).toBe("/access/requiredEntitlementKey");
    });

    it("names the field of the provenance that is missing", () => {
      const report = service.validate(document(), context, [
        {
          entityContentKey: "country.france",
          licenseName: "CC0",
          sourceUrl: null,
          replacementReason: "upstream drawing is wrong",
        },
      ]);

      const finding = report.findings.find(
        (entry) => entry.code === "ASSET_PROVENANCE_INCOMPLETE",
      );
      expect(finding?.target).toEqual({
        objectType: "asset",
        objectKey: "country.france",
        tab: "media",
        field: "/sourceUrl",
      });
    });

    it("reads a member written as a card ref rather than as a bare key", () => {
      const report = service.validate(
        document({
          decks: [
            {
              key: "deck.coats",
              kind: "curated",
              names: {
                ru: { name: "Гербы", description: "Гербы" },
                en: { name: "Coats", description: "Coats" },
              },
              members: [
                {
                  entityKey: "country.atlantis",
                  templateCode: "FLAG_TO_COUNTRY",
                  templateSchemaVersion: 1,
                },
              ],
            },
          ],
        }),
        context,
        [],
      );

      const finding = report.findings.find(
        (entry) => entry.code === "MEMBER_UNKNOWN",
      );
      expect(finding?.message).toContain("country.atlantis");
    });

    it("gives every finding a route once the draft is known", () => {
      const report = withFindingRoutes(
        service.validate(
          document({
            decks: [
              {
                key: "deck.all",
                kind: "curated",
                names: { ru: { name: "Все", description: "Все страны" } },
                members: "all-current",
              },
            ],
          }),
          context,
          [],
        ),
        "5b1b1c1e-0000-4000-8000-000000000001",
      );

      expect(report.findings.length).toBeGreaterThan(0);
      expect(
        report.findings.every(
          (finding) =>
            finding.route?.startsWith(
              "/drafts/5b1b1c1e-0000-4000-8000-000000000001",
            ) === true,
        ),
      ).toBe(true);
      expect(
        report.findings.find(
          (finding) => finding.code === "DECK_LOCALIZATION_MISSING",
        )?.route,
      ).toBe("/drafts/5b1b1c1e-0000-4000-8000-000000000001/decks/deck.all");
    });
  });
});
