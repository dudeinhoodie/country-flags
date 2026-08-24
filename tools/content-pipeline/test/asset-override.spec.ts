import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { loadAssetOverrides } from "../src/asset-overrides.js";
import { createMatcher } from "../src/matching.js";
import { mergeContent } from "../src/merge.js";
import type {
  AssetCandidate,
  EditorialCatalog,
  NormalizedSource,
  Provenance,
} from "../src/types.js";

const temporaryRoots: string[] = [];

after(async () => {
  for (const root of temporaryRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

const UPSTREAM_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#111111"/></svg>';
const OVERRIDE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#2222ff"/></svg>';

const editorialProvenance: Provenance = {
  sourceKey: "editorial",
  revision: "editorial-test",
  retrievedAt: "2026-08-23T00:00:00.000Z",
};

function catalog(
  overrides?: EditorialCatalog["assetOverrides"],
): EditorialCatalog {
  return {
    schemaVersion: 1,
    defaultLocale: "ru",
    supportedLocales: ["ru", "en"],
    entities: [
      {
        key: "country.alpha",
        type: "country",
        status: "active",
        includeInCountryCatalog: true,
        recognitionStatus: "un_member",
        identifiers: { isoAlpha2: "AA" },
        overrides: {
          "names.ru.short": "Альфа",
          "names.en.short": "Alpha",
        },
      },
      {
        key: "country.beta",
        type: "country",
        status: "active",
        includeInCountryCatalog: true,
        recognitionStatus: "un_member",
        identifiers: { isoAlpha2: "BB" },
        overrides: {
          "names.ru.short": "Бета",
          "names.en.short": "Beta",
        },
      },
    ],
    sourceAliases: {},
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
    ...(overrides === undefined ? {} : { assetOverrides: overrides }),
  };
}

function upstreamAsset(isoAlpha2: string, svg: string): AssetCandidate {
  return {
    entity: { isoAlpha2 },
    upstreamPath: `flags/${isoAlpha2.toLowerCase()}.svg`,
    svg,
    aspectRatio: 1.5,
    provenance: {
      sourceKey: "flag-icons",
      revision: "flags-test",
      retrievedAt: "2026-08-23T00:00:00.000Z",
    },
    license: "CC0-1.0",
  };
}

function normalizedSources(): NormalizedSource[] {
  return [
    {
      patches: [],
      relations: [],
      assets: [
        upstreamAsset("AA", UPSTREAM_SVG),
        upstreamAsset("BB", UPSTREAM_SVG),
      ],
    },
  ];
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "country-flags-override-"));
  temporaryRoots.push(root);
  return root;
}

async function build(
  editorial: EditorialCatalog,
  root: string,
): Promise<Awaited<ReturnType<typeof mergeContent>>> {
  const outputDirectory = join(root, "out");
  await mkdir(outputDirectory, { recursive: true });
  const normalized = normalizedSources();
  return mergeContent(
    outputDirectory,
    "override-test-v1",
    editorial,
    normalized,
    createMatcher(editorial, normalized),
    editorialProvenance,
    await loadAssetOverrides(
      root,
      editorial.assetOverrides,
      editorialProvenance,
    ),
  );
}

void test("an editorial override outranks the adapter candidate", async () => {
  const root = await temporaryRoot();
  await mkdir(join(root, "editorial/overrides/assets"), { recursive: true });
  await writeFile(
    join(root, "editorial/overrides/assets/country.alpha.svg"),
    OVERRIDE_SVG,
    "utf8",
  );

  const merged = await build(
    catalog([
      {
        entityKey: "country.alpha",
        assetType: "flag",
        aspectRatio: 1.5,
        license: "CC-BY-4.0",
        sourceUrl: "https://commons.example.test/alpha.svg",
        attribution: "An editor",
        reason: "The upstream drawing used the wrong shade.",
      },
    ]),
    root,
  );

  const overridden = merged.assets.find(
    ({ entityKey }) => entityKey === "country.alpha",
  );
  assert.ok(overridden, "the overridden entity still publishes an asset");
  const vector = overridden.representations[0];
  assert.ok(vector);
  const published = await readFile(join(root, "out", vector.path), "utf8");
  assert.match(published, /#2222ff/u, "the override's drawing is published");
  assert.equal(overridden.license, "CC-BY-4.0");
  assert.equal(overridden.attribution, "An editor");
  assert.equal(overridden.provenance.sourceKey, "editorial");

  // The entity nobody overrode still comes from the adapter, untouched.
  const untouched = merged.assets.find(
    ({ entityKey }) => entityKey === "country.beta",
  );
  assert.ok(untouched);
  assert.equal(untouched.provenance.sourceKey, "flag-icons");
});

void test("an override that displaces a source is reported, never silent", async () => {
  const root = await temporaryRoot();
  await mkdir(join(root, "editorial/overrides/assets"), { recursive: true });
  await writeFile(
    join(root, "editorial/overrides/assets/country.alpha.svg"),
    OVERRIDE_SVG,
    "utf8",
  );

  const merged = await build(
    catalog([
      {
        entityKey: "country.alpha",
        assetType: "flag",
        aspectRatio: 1.5,
        license: "CC-BY-4.0",
        sourceUrl: "https://commons.example.test/alpha.svg",
        reason: "The upstream drawing used the wrong shade.",
      },
    ]),
    root,
  );

  assert.equal(merged.reports.assetOverrides.length, 1);
  const [report] = merged.reports.assetOverrides;
  assert.ok(report);
  assert.equal(report.entityKey, "country.alpha");
  assert.match(report.reason, /wrong shade/u);
  assert.deepEqual(report.shadowedSourceKeys, ["flag-icons"]);
  // The checksum of the drawing that was displaced: a refresh that changes
  // the upstream flag changes this, which is the signal for a second look.
  assert.match(report.shadowedSha256 ?? "", /^[0-9a-f]{64}$/u);
});

void test("an override for an entity no source covers displaces nothing", async () => {
  const root = await temporaryRoot();
  await mkdir(join(root, "editorial/overrides/assets"), { recursive: true });
  await writeFile(
    join(root, "editorial/overrides/assets/country.gamma.svg"),
    OVERRIDE_SVG,
    "utf8",
  );

  const withGamma = catalog([
    {
      entityKey: "country.gamma",
      assetType: "flag",
      aspectRatio: 1.5,
      license: "CC0-1.0",
      sourceUrl: "https://commons.example.test/gamma.svg",
      reason: "No upstream project draws this flag.",
    },
  ]);
  withGamma.entities.push({
    key: "country.gamma",
    type: "country",
    status: "active",
    includeInCountryCatalog: true,
    recognitionStatus: "un_member",
    identifiers: { isoAlpha2: "GG" },
    overrides: {
      "names.ru.short": "Гамма",
      "names.en.short": "Gamma",
    },
  });

  const merged = await build(withGamma, root);
  const report = merged.reports.assetOverrides.find(
    ({ entityKey }) => entityKey === "country.gamma",
  );
  assert.ok(report);
  assert.deepEqual(report.shadowedSourceKeys, []);
  assert.equal(report.shadowedSha256, null);
});

void test("a declared override with no file fails the build", async () => {
  const root = await temporaryRoot();
  await assert.rejects(
    build(
      catalog([
        {
          entityKey: "country.alpha",
          assetType: "flag",
          aspectRatio: 1.5,
          license: "CC0-1.0",
          sourceUrl: "https://commons.example.test/alpha.svg",
          reason: "Declared but never supplied.",
        },
      ]),
      root,
    ),
    /does not exist/u,
  );
});

void test("an unsafe override drawing is refused", async () => {
  const root = await temporaryRoot();
  await mkdir(join(root, "editorial/overrides/assets"), { recursive: true });
  await writeFile(
    join(root, "editorial/overrides/assets/country.alpha.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2" onload="steal()"><rect/></svg>',
    "utf8",
  );
  await assert.rejects(
    build(
      catalog([
        {
          entityKey: "country.alpha",
          assetType: "flag",
          aspectRatio: 1.5,
          license: "CC0-1.0",
          sourceUrl: "https://commons.example.test/alpha.svg",
          reason: "Hostile input must not reach the bundle.",
        },
      ]),
      root,
    ),
    /Unsafe SVG/u,
  );
});
