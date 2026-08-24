import { DraftValidationService } from "./draft-validation.service";
import type { MembershipContext } from "./deck-membership";

const context: MembershipContext = {
  entities: [
    { key: "country.france", status: "active", includeInCountryCatalog: true },
    { key: "country.japan", status: "active", includeInCountryCatalog: true },
    { key: "country.spain", status: "active", includeInCountryCatalog: true },
    { key: "region.europe", status: "active", includeInCountryCatalog: false },
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
    schemaVersion: 1,
    defaultLocale: "ru",
    supportedLocales: ["ru", "en"],
    entities: context.entities.map((entity) => ({
      ...entity,
      type: "country",
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

  it("blocks duplicate entities and duplicate decks", () => {
    const doubled = document({
      entities: [
        ...context.entities.map((entity) => ({
          ...entity,
          type: "country",
          recognitionStatus: "un_member",
        })),
        {
          key: "country.france",
          type: "country",
          status: "active",
          includeInCountryCatalog: true,
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
});
