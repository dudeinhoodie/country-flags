import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020";
import type { ValidateFunction } from "ajv";

import { planCarry } from "./draft-carry";
import type { CarriedAsset } from "./draft-carry";

/** The published schema, read from contracts rather than mirrored. */
function schemaValidator(version: number): ValidateFunction {
  const path = resolve(
    __dirname,
    `../../../../contracts/schemas/content/editorial-catalog.v${String(
      version,
    )}.schema.json`,
  );
  const schema = JSON.parse(readFileSync(path, "utf8")) as object;
  return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
}

function entity(
  key: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    key,
    type: "country",
    status: "active",
    config: { includeInCountryCatalog: true },
    recognitionStatus: "un_member",
    ...extra,
  };
}

function deck(
  key: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    key,
    kind: "curated",
    names: {
      ru: { name: "Все", description: "Все страны" },
      en: { name: "All", description: "All countries" },
    },
    members: ["country.germany", "country.france"],
    ...extra,
  };
}

function catalog(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    defaultLocale: "ru",
    supportedLocales: ["ru", "en"],
    sourceAliases: {},
    additionalRelations: [],
    entities: [entity("country.germany"), entity("country.france")],
    decks: [deck("deck.all")],
    ...extra,
  };
}

/** A deep copy, so a test that edits one side cannot touch another. */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function entitiesOf(
  document: Record<string, unknown>,
): Record<string, unknown>[] {
  return document.entities as Record<string, unknown>[];
}

function entityIn(
  document: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  return entitiesOf(document).find((entry) => entry.key === key);
}

describe("planCarry", () => {
  it("carries a draft whose edits touch nothing the catalog moved", () => {
    const base = catalog();
    const mine = copy(base);
    entityIn(mine, "country.germany")!.recognitionStatus = "observer";
    const theirs = copy(base);
    entityIn(theirs, "country.france")!.status = "historical";

    const plan = planCarry(base, mine, theirs);

    expect(plan.collisions).toEqual([]);
    // Both edits survive: the draft's on Germany, the catalog's on France.
    expect(entityIn(plan.document, "country.germany")?.recognitionStatus).toBe(
      "observer",
    );
    expect(entityIn(plan.document, "country.france")?.status).toBe(
      "historical",
    );
    expect(plan.incoming).toEqual([
      { objectType: "entity", objectKey: "country.france", change: "changed" },
    ]);
    expect(schemaValidator(2)(plan.document)).toBe(true);
  });

  it("merges two edits to different fields of the same object", () => {
    const base = catalog();
    const mine = copy(base);
    entityIn(mine, "country.germany")!.overrides = {
      "names.ru.short": "Германия",
    };
    const theirs = copy(base);
    entityIn(theirs, "country.germany")!.identifiers = { isoAlpha2: "DE" };

    const plan = planCarry(base, mine, theirs);

    expect(plan.collisions).toEqual([]);
    expect(entityIn(plan.document, "country.germany")).toMatchObject({
      overrides: { "names.ru.short": "Германия" },
      identifiers: { isoAlpha2: "DE" },
    });
  });

  it("refuses the field both sides moved, and names it the way the editor sees it", () => {
    const base = catalog({
      entities: [
        entity("country.germany", { overrides: { "names.ru.short": "ФРГ" } }),
      ],
    });
    const mine = copy(base);
    entityIn(mine, "country.germany")!.overrides = {
      "names.ru.short": "Германия",
    };
    const theirs = copy(base);
    entityIn(theirs, "country.germany")!.overrides = {
      "names.ru.short": "Германия (ФРГ)",
    };

    const plan = planCarry(base, mine, theirs);

    expect(plan.collisions).toHaveLength(1);
    expect(plan.collisions[0]).toMatchObject({
      level: "blocking",
      code: "FIELD_CHANGED_ON_BOTH_SIDES",
      subject: "country.germany",
      target: {
        objectType: "entity",
        objectKey: "country.germany",
        tab: "names",
        field: "/names/ru/short",
      },
    });
  });

  it("merges two first overrides of the same entity, which is not one change twice", () => {
    const base = catalog();
    const mine = copy(base);
    entityIn(mine, "country.germany")!.overrides = {
      "names.ru.short": "Германия",
    };
    const theirs = copy(base);
    entityIn(theirs, "country.germany")!.overrides = {
      "names.en.official": "Federal Republic of Germany",
    };

    const plan = planCarry(base, mine, theirs);

    expect(plan.collisions).toEqual([]);
    expect(entityIn(plan.document, "country.germany")?.overrides).toEqual({
      "names.ru.short": "Германия",
      "names.en.official": "Federal Republic of Germany",
    });
  });

  it("counts the same value on both sides as agreement, not a collision", () => {
    const base = catalog();
    const mine = copy(base);
    entityIn(mine, "country.germany")!.status = "historical";
    const theirs = copy(base);
    entityIn(theirs, "country.germany")!.status = "historical";

    const plan = planCarry(base, mine, theirs);

    expect(plan.collisions).toEqual([]);
    expect(entityIn(plan.document, "country.germany")?.status).toBe(
      "historical",
    );
  });

  it("brings in an entity the catalog gained and drops one it lost", () => {
    const base = catalog();
    const mine = copy(base);
    entityIn(mine, "country.germany")!.recognitionStatus = "observer";
    const theirs = copy(base);
    theirs.entities = [
      entityIn(theirs, "country.germany")!,
      entity("country.spain"),
    ];

    const plan = planCarry(base, mine, theirs);

    expect(plan.collisions).toEqual([]);
    expect(entitiesOf(plan.document).map((entry) => entry.key)).toEqual([
      "country.germany",
      "country.spain",
    ]);
    expect(plan.incoming).toEqual(
      expect.arrayContaining([
        { objectType: "entity", objectKey: "country.spain", change: "added" },
        {
          objectType: "entity",
          objectKey: "country.france",
          change: "removed",
        },
      ]),
    );
  });

  it("refuses when the catalog removed an object the draft edited", () => {
    const base = catalog();
    const mine = copy(base);
    entityIn(mine, "country.france")!.status = "historical";
    const theirs = copy(base);
    theirs.entities = [entityIn(theirs, "country.germany")!];

    const plan = planCarry(base, mine, theirs);

    expect(plan.collisions).toHaveLength(1);
    expect(plan.collisions[0]).toMatchObject({
      code: "OBJECT_CHANGED_ON_BOTH_SIDES",
      subject: "country.france",
      target: { objectType: "entity", tab: "overview", field: null },
    });
  });

  it("refuses when the draft removed an object the catalog edited", () => {
    const base = catalog();
    const mine = copy(base);
    mine.entities = [entityIn(mine, "country.germany")!];
    const theirs = copy(base);
    entityIn(theirs, "country.france")!.status = "historical";

    const plan = planCarry(base, mine, theirs);

    expect(plan.collisions).toHaveLength(1);
    expect(plan.collisions[0]?.subject).toBe("country.france");
  });

  it("treats a deck's member list as one field, and refuses it moved twice", () => {
    const base = catalog();
    const mine = copy(base);
    (mine.decks as Record<string, unknown>[])[0]!.members = [
      "country.france",
      "country.germany",
    ];
    const theirs = copy(base);
    (theirs.decks as Record<string, unknown>[])[0]!.members = [
      "country.germany",
      "country.france",
      "country.spain",
    ];

    const plan = planCarry(base, mine, theirs);

    expect(plan.collisions).toHaveLength(1);
    expect(plan.collisions[0]?.target).toEqual({
      objectType: "deck",
      objectKey: "deck.all",
      tab: "content",
      field: "/members",
    });
  });

  it("carries a deck rename over a membership change in the catalog", () => {
    const base = catalog();
    const mine = copy(base);
    (
      (mine.decks as Record<string, unknown>[])[0]!.names as Record<
        string,
        Record<string, string>
      >
    ).en = { name: "Every flag", description: "All countries" };
    const theirs = copy(base);
    (theirs.decks as Record<string, unknown>[])[0]!.members = [
      "country.germany",
    ];

    const plan = planCarry(base, mine, theirs);

    expect(plan.collisions).toEqual([]);
    const carried = (plan.document.decks as Record<string, unknown>[])[0]!;
    expect(carried.members).toEqual(["country.germany"]);
    expect(
      (carried.names as Record<string, Record<string, string>>).en,
    ).toEqual({ name: "Every flag", description: "All countries" });
  });

  it("carries a change to a catalog-wide field the draft did not touch", () => {
    const base = catalog();
    const mine = copy(base);
    entityIn(mine, "country.germany")!.status = "historical";
    const theirs = copy(base);
    theirs.supportedLocales = ["ru", "en", "de"];

    const plan = planCarry(base, mine, theirs);

    expect(plan.collisions).toEqual([]);
    expect(plan.document.supportedLocales).toEqual(["ru", "en", "de"]);
    expect(plan.incoming).toContainEqual({
      objectType: "catalog",
      objectKey: "catalog/supportedLocales",
      change: "changed",
    });
  });

  it("keeps the newer schema version when the draft was lifted and the catalog was not", () => {
    const base = catalog();
    const mine = copy(base);
    mine.schemaVersion = 3;
    const theirs = copy(base);
    entityIn(theirs, "country.france")!.status = "historical";

    const plan = planCarry(base, mine, theirs);

    expect(plan.collisions).toEqual([]);
    expect(plan.document.schemaVersion).toBe(3);
  });

  describe("uploaded drawings", () => {
    const upload: CarriedAsset = {
      entityContentKey: "country.germany",
      assetType: "coat_of_arms",
      variant: "current",
    };

    it("lets an upload through when the catalog left that symbol alone", () => {
      const base = catalog();
      const theirs = copy(base);
      entityIn(theirs, "country.france")!.status = "historical";

      expect(planCarry(base, copy(base), theirs, [upload]).collisions).toEqual(
        [],
      );
    });

    it("refuses an upload that would replace an override the catalog gained", () => {
      const base = catalog();
      const theirs = copy(base);
      theirs.schemaVersion = 3;
      theirs.assetOverrides = [
        {
          entityKey: "country.germany",
          assetType: "coat_of_arms",
          variant: "current",
          aspectRatio: 1,
          license: "CC0-1.0",
          sourceUrl: "https://commons.example.test/coa.svg",
          reason: "Upstream had none",
        },
      ];

      const plan = planCarry(base, copy(base), theirs, [upload]);

      expect(plan.collisions).toHaveLength(1);
      expect(plan.collisions[0]).toMatchObject({
        code: "UPLOAD_OVERWRITES_CATALOG_ASSET",
        subject: "country.germany",
        target: { objectType: "asset", tab: "media" },
      });
    });

    it("ignores an override of another symbol of the same entity", () => {
      const base = catalog();
      const theirs = copy(base);
      theirs.schemaVersion = 3;
      theirs.assetOverrides = [
        {
          entityKey: "country.germany",
          assetType: "flag",
          variant: "current",
          aspectRatio: 1.5,
          license: "CC0-1.0",
          sourceUrl: "https://commons.example.test/flag.svg",
          reason: "The upstream shade was wrong",
        },
      ];

      expect(planCarry(base, copy(base), theirs, [upload]).collisions).toEqual(
        [],
      );
    });

    it("refuses an upload whose entity the catalog no longer carries", () => {
      const base = catalog();
      const theirs = copy(base);
      theirs.entities = [entityIn(theirs, "country.france")!];

      const plan = planCarry(base, copy(base), theirs, [upload]);

      expect(plan.collisions).toHaveLength(1);
      expect(plan.collisions[0]?.code).toBe(
        "UPLOAD_ENTITY_REMOVED_FROM_CATALOG",
      );
    });
  });
});
