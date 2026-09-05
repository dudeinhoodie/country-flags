import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";

interface AjvInstance {
  compile(schema: object): ValidateFunction;
}

const AjvConstructor = Ajv2020 as unknown as new (options: {
  allErrors: boolean;
  strict: boolean;
}) => AjvInstance;

import { loadAssetOverrides } from "../src/asset-overrides.js";
import { migrateEditorialCatalog } from "../src/editorial-schema.js";
import { createMatcher } from "../src/matching.js";
import { mergeContent } from "../src/merge.js";
import type {
  AssetCandidate,
  EditorialCatalog,
  EditorialCatalogV2,
  NormalizedSource,
  Provenance,
} from "../src/types.js";

const pipelineRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots: string[] = [];

after(async () => {
  for (const root of temporaryRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "country-flags-editorial-"));
  temporaryRoots.push(root);
  return root;
}

const editorialProvenance: Provenance = {
  sourceKey: "editorial",
  revision: "editorial-test",
  retrievedAt: "2026-08-23T00:00:00.000Z",
};

const OVERRIDE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#2222ff"/></svg>';

function v2Catalog(): EditorialCatalogV2 {
  return {
    schemaVersion: 2,
    defaultLocale: "ru",
    supportedLocales: ["ru", "en"],
    entities: [
      {
        key: "country.alpha",
        type: "country",
        status: "active",
        config: { includeInCountryCatalog: true },
        recognitionStatus: "un_member",
        identifiers: { isoAlpha2: "AA" },
      },
    ],
    sourceAliases: {},
    additionalRelations: [],
    decks: [
      {
        key: "deck.all",
        kind: "curated",
        names: { en: { name: "All", description: "All countries" } },
        members: "all-current",
      },
      {
        key: "deck.picks",
        kind: "curated",
        names: { en: { name: "Picks", description: "A hand-picked pair." } },
        members: ["country.alpha"],
      },
    ],
    assetOverrides: [
      {
        entityKey: "country.alpha",
        assetType: "flag",
        aspectRatio: 1.5,
        license: "CC0-1.0",
        sourceUrl: "https://commons.example.test/alpha.svg",
        reason: "The upstream drawing used the wrong shade.",
      },
    ],
  };
}

void test("a v2 catalog is read as the v3 document it always meant", () => {
  const lifted = migrateEditorialCatalog(v2Catalog());

  assert.equal(lifted.schemaVersion, 3);
  // Every card the catalog has published shows a flag and asks for the
  // entity, so that is what a member key written before templates meant.
  for (const deck of lifted.decks) {
    assert.equal(deck.defaultTemplateCode, "FLAG_TO_COUNTRY");
    assert.equal(deck.defaultTemplateSchemaVersion, 1);
  }
  const [override] = lifted.assetOverrides ?? [];
  assert.ok(override);
  assert.equal(override.assetType, "flag");
  assert.equal(override.variant, "current");
});

void test("the lift leaves the document on disk alone", () => {
  const document = v2Catalog();
  migrateEditorialCatalog(document);

  const [deck] = document.decks;
  assert.ok(deck);
  assert.equal(document.schemaVersion, 2);
  assert.equal(
    "defaultTemplateCode" in deck,
    false,
    "reading the catalog must not rewrite it",
  );
});

void test("a v3 catalog is read as it was written", () => {
  const document: EditorialCatalog = {
    ...migrateEditorialCatalog(v2Catalog()),
    decks: [
      {
        key: "deck.symbols",
        kind: "curated",
        names: { en: { name: "Symbols", description: "Both symbols." } },
        defaultTemplateCode: "COAT_OF_ARMS_TO_COUNTRY",
        defaultTemplateSchemaVersion: 1,
        members: ["country.alpha"],
      },
    ],
  };

  const read = migrateEditorialCatalog(document);

  assert.equal(read.decks[0]?.defaultTemplateCode, "COAT_OF_ARMS_TO_COUNTRY");
});

void test("a version the pipeline does not know is refused, not guessed", () => {
  const document = { ...v2Catalog(), schemaVersion: 1 };

  assert.throws(
    () =>
      migrateEditorialCatalog(
        document as unknown as ReturnType<typeof v2Catalog>,
      ),
    /schema version 1/u,
  );
});

void test("a v2 document's drawing is still found in the flat layout", async () => {
  const root = await temporaryRoot();
  await mkdir(join(root, "editorial/overrides/assets"), { recursive: true });
  await writeFile(
    join(root, "editorial/overrides/assets/country.alpha.svg"),
    OVERRIDE_SVG,
    "utf8",
  );

  const lifted = migrateEditorialCatalog(v2Catalog());
  const [loaded] = await loadAssetOverrides(
    root,
    lifted.assetOverrides,
    editorialProvenance,
  );

  assert.ok(loaded);
  assert.equal(
    loaded.candidate.upstreamPath,
    "editorial/overrides/assets/country.alpha.svg",
    "lifting a document in memory must not move files on disk",
  );
});

void test("a coat of arms and a flag no longer fight over one file", async () => {
  const root = await temporaryRoot();
  await mkdir(join(root, "editorial/overrides/assets/country.alpha/flag"), {
    recursive: true,
  });
  await mkdir(
    join(root, "editorial/overrides/assets/country.alpha/coat_of_arms"),
    { recursive: true },
  );
  await writeFile(
    join(root, "editorial/overrides/assets/country.alpha/flag/current.svg"),
    OVERRIDE_SVG,
    "utf8",
  );
  await writeFile(
    join(
      root,
      "editorial/overrides/assets/country.alpha/coat_of_arms/current.svg",
    ),
    OVERRIDE_SVG.replace("#2222ff", "#cc9900"),
    "utf8",
  );

  const loaded = await loadAssetOverrides(
    root,
    [
      {
        entityKey: "country.alpha",
        assetType: "flag",
        variant: "current",
        aspectRatio: 1.5,
        license: "CC0-1.0",
        sourceUrl: "https://commons.example.test/alpha-flag.svg",
        reason: "The upstream drawing used the wrong shade.",
      },
      {
        entityKey: "country.alpha",
        assetType: "coat_of_arms",
        variant: "current",
        aspectRatio: 0.8,
        license: "Public domain",
        sourceUrl: "https://commons.example.test/alpha-coat.svg",
        reason: "Verified official artwork.",
      },
    ],
    editorialProvenance,
  );

  assert.equal(loaded.length, 2);
  assert.deepEqual(
    loaded.map(({ candidate }) => candidate.upstreamPath),
    [
      "editorial/overrides/assets/country.alpha/flag/current.svg",
      "editorial/overrides/assets/country.alpha/coat_of_arms/current.svg",
    ],
  );
  const [flag, coat] = loaded;
  assert.ok(flag?.candidate.svg);
  assert.ok(coat?.candidate.svg);
  assert.notEqual(flag.candidate.svg, coat.candidate.svg);
});

function upstreamAsset(isoAlpha2: string): AssetCandidate {
  return {
    entity: { isoAlpha2 },
    upstreamPath: `flags/${isoAlpha2.toLowerCase()}.svg`,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#111111"/></svg>',
    aspectRatio: 1.5,
    provenance: {
      sourceKey: "flag-icons",
      revision: "flags-test",
      retrievedAt: "2026-08-23T00:00:00.000Z",
    },
    license: "CC0-1.0",
  };
}

void test("a subdivision never joins the all-countries deck", async () => {
  const root = await temporaryRoot();
  const outputDirectory = join(root, "out");
  await mkdir(outputDirectory, { recursive: true });

  const editorial: EditorialCatalog = {
    ...migrateEditorialCatalog(v2Catalog()),
    entities: [
      {
        key: "country.alpha",
        type: "country",
        status: "active",
        config: { includeInCountryCatalog: true },
        recognitionStatus: "un_member",
        identifiers: { isoAlpha2: "AA" },
        overrides: { "names.en.short": "Alpha", "names.ru.short": "Альфа" },
      },
      {
        key: "subdivision.alpha.north",
        type: "subdivision",
        status: "active",
        parentKey: "country.alpha",
        config: { includeInCountryCatalog: false },
        recognitionStatus: "not_applicable",
        identifiers: { isoSubdivision: "AA-N" },
        overrides: { "names.en.short": "North", "names.ru.short": "Север" },
      },
    ],
    decks: [
      {
        key: "deck.all",
        kind: "curated",
        names: { en: { name: "All", description: "All countries" } },
        defaultTemplateCode: "FLAG_TO_COUNTRY",
        defaultTemplateSchemaVersion: 1,
        members: "all-current",
      },
      {
        key: "deck.states",
        kind: "curated",
        names: { en: { name: "States", description: "State flags." } },
        defaultTemplateCode: "FLAG_TO_COUNTRY",
        defaultTemplateSchemaVersion: 1,
        members: ["subdivision.alpha.north"],
      },
    ],
  };
  const normalized: NormalizedSource[] = [
    { patches: [], relations: [], assets: [upstreamAsset("AA")] },
  ];

  const merged = await mergeContent(
    outputDirectory,
    "subdivision-test-v1",
    editorial,
    normalized,
    createMatcher(editorial, normalized),
    editorialProvenance,
  );

  const decks = merged.catalog.decks as {
    key: string;
    memberEntityKeys: string[];
  }[];
  const all = decks.find(({ key }) => key === "deck.all");
  const states = decks.find(({ key }) => key === "deck.states");
  assert.ok(all);
  assert.ok(states);
  assert.deepEqual(all.memberEntityKeys, ["country.alpha"]);
  // The state is still publishable — it is simply not a country.
  assert.deepEqual(states.memberEntityKeys, ["subdivision.alpha.north"]);
  assert.equal(
    merged.learnableEntityKeys.includes("subdivision.alpha.north"),
    false,
  );
});

void test("one entity written twice under one template is one member", async () => {
  const root = await temporaryRoot();
  const outputDirectory = join(root, "out");
  await mkdir(outputDirectory, { recursive: true });

  const base = migrateEditorialCatalog(v2Catalog());
  const editorial: EditorialCatalog = {
    ...base,
    entities: [
      {
        key: "country.alpha",
        type: "country",
        status: "active",
        config: { includeInCountryCatalog: true },
        recognitionStatus: "un_member",
        identifiers: { isoAlpha2: "AA" },
        overrides: { "names.en.short": "Alpha", "names.ru.short": "Альфа" },
      },
    ],
    decks: [
      {
        key: "deck.symbols",
        kind: "curated",
        names: { en: { name: "Symbols", description: "Both symbols." } },
        defaultTemplateCode: "FLAG_TO_COUNTRY",
        defaultTemplateSchemaVersion: 1,
        members: [
          "country.alpha",
          {
            entityKey: "country.alpha",
            templateCode: "COAT_OF_ARMS_TO_COUNTRY",
            templateSchemaVersion: 1,
          },
        ],
      },
    ],
  };
  const normalized: NormalizedSource[] = [
    { patches: [], relations: [], assets: [upstreamAsset("AA")] },
  ];

  const merged = await mergeContent(
    outputDirectory,
    "mixed-deck-test-v1",
    editorial,
    normalized,
    createMatcher(editorial, normalized),
    editorialProvenance,
  );

  // Two card variants of one country, and the published catalog still lists
  // entities: the second card appears once membership is materialized per
  // template (#315).
  const decks = merged.catalog.decks as {
    key: string;
    memberEntityKeys: string[];
  }[];
  assert.deepEqual(decks[0]?.memberEntityKeys, ["country.alpha"]);
});

async function v3Validator(): Promise<ValidateFunction> {
  const schema = JSON.parse(
    await readFile(
      resolve(
        pipelineRoot,
        "../../contracts/schemas/content/editorial-catalog.v3.schema.json",
      ),
      "utf8",
    ),
  ) as object;
  return new AjvConstructor({ allErrors: true, strict: true }).compile(schema);
}

/** The item at an index, refusing to pretend an empty list has one. */
function at<Item>(items: Item[], index: number): Item {
  const item = items[index];
  assert.ok(item, `expected an item at index ${String(index)}`);
  return item;
}

/** Only the parts of the document the refusal cases reach into. */
interface TestDocument {
  entities: (Record<string, unknown> & {
    parentKey?: string;
    config: { includeInCountryCatalog: boolean };
    identifiers?: Record<string, string>;
  })[];
  decks: (Record<string, unknown> & {
    defaultTemplateCode?: string;
    access?: { model: string; requiredEntitlementKey?: string };
    previewCards?: string[];
  })[];
}

function v3Document(): TestDocument & Record<string, unknown> {
  return {
    schemaVersion: 3,
    defaultLocale: "ru",
    supportedLocales: ["ru", "en"],
    entities: [
      {
        key: "country.united_states",
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
        identifiers: { isoSubdivision: "US-CA" },
      },
    ],
    sourceAliases: {},
    additionalRelations: [],
    decks: [
      {
        key: "deck.us_state_flags",
        kind: "curated",
        names: { en: { name: "States", description: "State flags." } },
        defaultTemplateCode: "FLAG_TO_COUNTRY",
        defaultTemplateSchemaVersion: 1,
        members: ["subdivision.us.california"],
        access: {
          model: "ENTITLEMENT",
          requiredEntitlementKey: "deck.us_state_flags",
        },
      },
    ],
  };
}

void test("the v3 schema refuses the documents that would break the model", async () => {
  const validate = await v3Validator();
  assert.equal(validate(v3Document()), true, JSON.stringify(validate.errors));

  const cases: { name: string; mutate: (doc: TestDocument) => void }[] = [
    {
      name: "a state with no country above it",
      mutate: (doc) => {
        delete doc.entities[1]?.parentKey;
      },
    },
    {
      name: "a country given an administrative parent",
      mutate: (doc) => {
        at(doc.entities, 0).parentKey = "region.americas";
      },
    },
    {
      name: "a state listed among the countries",
      mutate: (doc) => {
        at(doc.entities, 1).config.includeInCountryCatalog = true;
      },
    },
    {
      name: "a subdivision code written as a country code",
      mutate: (doc) => {
        const state = at(doc.entities, 1);
        state.identifiers = { ...state.identifiers, isoAlpha2: "US-CA" };
      },
    },
    {
      name: "bare member keys with no template to read them by",
      mutate: (doc) => {
        delete doc.decks[0]?.defaultTemplateCode;
      },
    },
    {
      name: "a paid deck with no entitlement to sell",
      mutate: (doc) => {
        delete doc.decks[0]?.access?.requiredEntitlementKey;
      },
    },
    {
      name: "a free deck that still names an entitlement",
      mutate: (doc) => {
        const deck = at(doc.decks, 0);
        deck.access = { ...deck.access, model: "FREE" };
      },
    },
    {
      name: "a locked deck previewing more than three cards",
      mutate: (doc) => {
        at(doc.decks, 0).previewCards = ["a", "b", "c", "d"];
      },
    },
  ];

  for (const { name, mutate } of cases) {
    const document = v3Document();
    mutate(document);
    assert.equal(validate(document), false, `${name} should be refused`);
  }
});
