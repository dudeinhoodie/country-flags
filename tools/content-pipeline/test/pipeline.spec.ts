import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import { normalizeSource, sourceAdapter } from "../src/adapters.js";
import { sanitizeSvg } from "../src/assets.js";
import { buildBundle } from "../src/build.js";
import { createMatcher } from "../src/matching.js";
import {
  loadRegistry,
  loadVerifiedSnapshot,
  pullSource,
} from "../src/registry.js";
import { sha256, stableJson } from "../src/stable-json.js";
import type { EditorialCatalog } from "../src/types.js";

const pipelineRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function hashDirectory(directory: string): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (path: string, relativePath = ""): Promise<void> => {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name, "en"),
    )) {
      const childRelative = join(relativePath, entry.name);
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        await visit(child, childRelative);
      } else {
        hash.update(childRelative);
        hash.update(await readFile(child));
      }
    }
  };
  await visit(directory);
  return hash.digest("hex");
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const PNG_CHANNELS_BY_COLOR_TYPE = new Map([
  [0, 1],
  [2, 3],
  [3, 1],
  [4, 2],
  [6, 4],
]);

/// Decodes a published PNG the way an image decoder does: it walks the chunks
/// and inflates the pixel stream rather than trusting the header.
///
/// Issue #82 shipped 250 assets that downloaded and matched their checksums and
/// still never became a picture, so a check that stops at the bytes proves
/// nothing about whether the app can draw them.
function decodePng(
  bytes: Buffer,
  path: string,
): { width: number; height: number } {
  assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE), `${path} is not a PNG`);
  assert.equal(
    bytes.subarray(12, 16).toString("ascii"),
    "IHDR",
    `${path} does not start with a header chunk`,
  );
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes.readUInt8(24);
  const channels = PNG_CHANNELS_BY_COLOR_TYPE.get(bytes.readUInt8(25));
  assert.ok(channels !== undefined, `${path} declares an unknown colour type`);
  assert.equal(
    bytes.readUInt8(28),
    0,
    `${path} is interlaced, which the published set is not`,
  );

  const pixelStream: Buffer[] = [];
  let sawEnd = false;
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") {
      pixelStream.push(bytes.subarray(offset + 8, offset + 8 + length));
    }
    sawEnd ||= type === "IEND";
    offset += length + 12;
  }
  assert.ok(sawEnd, `${path} is truncated before its end chunk`);
  assert.ok(pixelStream.length > 0, `${path} carries no pixel data`);

  // A PNG row is one filter byte followed by its packed samples, so a stream
  // that inflates to anything else is not the picture the header describes.
  const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
  assert.equal(
    inflateSync(Buffer.concat(pixelStream)).length,
    height * (rowBytes + 1),
    `${path} does not inflate to a complete image`,
  );
  return { width, height };
}

/// Rasterizing every flag makes a build expensive, so the two builds the
/// determinism check needs are shared with the tests that read their output
/// instead of being repeated per test.
type OfflineBundle = Awaited<ReturnType<typeof buildBundle>>;

const temporaryRoots: string[] = [];
let offlineBuilds: Promise<OfflineBundle[]> | undefined;

function buildOfflineBundleTwice(): Promise<OfflineBundle[]> {
  offlineBuilds ??= (async () => {
    const builds: OfflineBundle[] = [];
    for (const suffix of ["a", "b"]) {
      const outputRoot = await mkdtemp(
        join(tmpdir(), `country-flags-content-${suffix}-`),
      );
      temporaryRoots.push(outputRoot);
      builds.push(
        await buildBundle({
          root: pipelineRoot,
          catalogVersion: "deterministic-test-v1",
          publishReady: true,
          outputRoot,
        }),
      );
    }
    return builds;
  })();
  return offlineBuilds;
}

after(async () => {
  for (const root of temporaryRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

void test("stable JSON ignores object insertion order", () => {
  assert.equal(
    stableJson({ z: 1, nested: { b: 2, a: 1 } }),
    stableJson({ nested: { a: 1, b: 2 }, z: 1 }),
  );
});

void test("all registered adapters normalize their offline snapshots", async () => {
  const registry = await loadRegistry(pipelineRoot);
  for (const source of registry.sources.filter(
    ({ key }) => key !== "editorial",
  )) {
    const snapshot = await loadVerifiedSnapshot(pipelineRoot, source);
    const normalized = normalizeSource(snapshot, source);
    assert.ok(
      normalized.patches.length +
        normalized.relations.length +
        normalized.assets.length >
        0,
      `${source.key} adapter produced no normalized output`,
    );
  }
});

void test("approved selection contains every current MVP country and territory", async () => {
  const registry = await loadRegistry(pipelineRoot);
  const editorialSource = registry.sources.find(
    ({ key }) => key === "editorial",
  );
  const unSource = registry.sources.find(({ key }) => key === "un-m49");
  const cldrSource = registry.sources.find(({ key }) => key === "cldr");
  const flagSource = registry.sources.find(({ key }) => key === "flag-icons");
  const wikidataSource = registry.sources.find(({ key }) => key === "wikidata");
  assert.ok(editorialSource);
  assert.ok(unSource);
  assert.ok(cldrSource);
  assert.ok(flagSource);
  assert.ok(wikidataSource);

  const editorial = await loadVerifiedSnapshot<EditorialCatalog>(
    pipelineRoot,
    editorialSource,
  );
  // The learnable pool, not the listing toggle: hiding an entity from the
  // all-countries deck is an editorial act and must not fail the build
  // contract (ADR-015).
  const included = editorial.entities.filter(
    ({ type, status }) =>
      status === "active" &&
      (type === "country" || type === "territory" || type === "area"),
  );
  assert.equal(included.length, 250);
  assert.equal(
    included.filter(
      ({ recognitionStatus }) => recognitionStatus === "un_member",
    ).length,
    193,
  );
  assert.equal(
    included.filter(
      ({ recognitionStatus }) => recognitionStatus === "un_observer",
    ).length,
    2,
  );
  assert.ok(included.some(({ key }) => key === "country.kosovo"));
  assert.ok(included.some(({ key }) => key === "country.taiwan"));

  const unSnapshot = await loadVerifiedSnapshot<{ records: unknown[] }>(
    pipelineRoot,
    unSource,
  );
  const cldrSnapshot = await loadVerifiedSnapshot<{
    territories: Record<string, unknown>;
  }>(pipelineRoot, cldrSource);
  const flagSnapshot = await loadVerifiedSnapshot<{ assets: unknown[] }>(
    pipelineRoot,
    flagSource,
  );
  const wikidataSnapshot = await loadVerifiedSnapshot<{
    bindings: { isoAlpha2: string; wikidataId: string }[];
  }>(pipelineRoot, wikidataSource);
  assert.equal(unSnapshot.records.length, 248);
  assert.equal(Object.keys(cldrSnapshot.territories).length, 250);
  assert.equal(flagSnapshot.assets.length, 250);
  assert.equal(
    wikidataSnapshot.bindings.find(({ isoAlpha2 }) => isoAlpha2 === "SA")
      ?.wikidataId,
    "Q851",
  );
  assert.equal(
    wikidataSnapshot.bindings.find(({ isoAlpha2 }) => isoAlpha2 === "AQ")
      ?.wikidataId,
    "Q51",
  );
});

void test("matching uses reliable identifiers and explicit aliases only", () => {
  const editorial: EditorialCatalog = {
    schemaVersion: 3,
    defaultLocale: "ru",
    supportedLocales: ["ru", "en"],
    entities: [
      {
        key: "country.france",
        type: "country",
        status: "active",
        config: { includeInCountryCatalog: true },
        recognitionStatus: "un_member",
        identifiers: { isoAlpha2: "FR" },
      },
      {
        key: "country.kosovo",
        type: "country",
        status: "active",
        config: { includeInCountryCatalog: true },
        recognitionStatus: "partially_recognized",
      },
    ],
    sourceAliases: { "cldr:XK": "country.kosovo" },
    additionalRelations: [],
    decks: [],
  };
  const matcher = createMatcher(editorial, []);
  assert.equal(matcher.resolve({ isoAlpha2: "FR" }), "country.france");
  assert.equal(matcher.resolve({ isoAlpha2: "XK" }, "cldr"), "country.kosovo");
  assert.equal(matcher.resolve({ editorialKey: "country.frnace" }), undefined);
  assert.deepEqual(
    matcher
      .unresolved({ editorialKey: "country.frnace" }, "editorial")
      .suggestedKeys.includes("country.france"),
    true,
  );
});

void test("SVG sanitizer rejects scripts, handlers, and external resources", () => {
  assert.match(
    sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>'),
    /^<svg/u,
  );
  for (const svg of [
    "<svg><script>alert(1)</script></svg>",
    '<svg><path onclick="alert(1)"/></svg>',
    '<svg><image href="https://example.com/a.png"/></svg>',
  ]) {
    assert.throws(() => sanitizeSvg(svg), /Unsafe SVG/u);
  }
});

void test("offline builds are byte-identical and preserve editorial overrides", async () => {
  const [first, second] = await buildOfflineBundleTwice();
  assert.ok(first);
  assert.ok(second);

  assert.equal(
    await hashDirectory(first.outputDirectory),
    await hashDirectory(second.outputDirectory),
  );
  assert.equal(first.reports.unresolvedEntities.length, 0);
  assert.equal(first.reports.missingTranslations.length, 0);
  assert.equal(first.reports.missingAssets.length, 0);
  assert.ok(first.reports.fieldConflicts.every(({ blocking }) => !blocking));
  assert.equal(
    first.reports.fieldConflicts.find(
      ({ entityKey, path }) =>
        entityKey === "country.united_states" && path === "names.ru.short",
    )?.resolution,
    "editorial_override",
  );
  assert.equal(
    first.reports.fieldConflicts.find(
      ({ entityKey, path }) =>
        entityKey === "country.france" && path === "facts.currencies",
    )?.resolution,
    "source_priority",
  );

  const catalog = JSON.parse(
    await readFile(join(first.outputDirectory, "catalog.json"), "utf8"),
  ) as {
    entities: {
      key: string;
      names?: Record<string, { short: string }>;
    }[];
  };
  const unitedStates = catalog.entities.find(
    ({ key }) => key === "country.united_states",
  );
  assert.equal(unitedStates?.names?.ru?.short, "США");
  assert.ok(
    catalog.entities.some(({ key }) => key === "subregion.western-europe"),
  );

  const population = JSON.parse(
    await readFile(
      join(first.outputDirectory, "facts/population.json"),
      "utf8",
    ),
  ) as {
    records: {
      entityKey: string;
      gap: boolean;
      value?: { year: number };
    }[];
  };
  assert.deepEqual(
    population.records.find(({ entityKey }) => entityKey === "country.kosovo"),
    {
      entityKey: "country.kosovo",
      gap: true,
      reason: "source_value_unavailable",
    },
  );
  assert.equal(
    population.records.find(({ entityKey }) => entityKey === "country.france")
      ?.value?.year,
    2024,
  );

  const currencies = JSON.parse(
    await readFile(
      join(first.outputDirectory, "facts/currencies.json"),
      "utf8",
    ),
  ) as {
    records: {
      entityKey: string;
      value?: { code: string; role: string; names?: unknown }[];
    }[];
  };
  assert.deepEqual(
    currencies.records
      .find(({ entityKey }) => entityKey === "country.france")
      ?.value?.at(0),
    {
      code: "EUR",
      names: { en: "Euro", ru: "евро" },
      role: "legal_tender",
    },
  );
});

/**
 * A fact with nothing in it is not a fact.
 *
 * Antarctica arrived from the source as `capitals: []` — an answer, not a
 * hole — and the pipeline published it as a fact with an empty value. The
 * card's back then had a row with a label and no text, and the release
 * carried a learning card nobody could learn anything from, with nothing
 * anywhere in the build reporting it (#272).
 */
void test("an absence is recorded as an absence, and a factless card must be declared", async () => {
  const [built] = await buildOfflineBundleTwice();
  assert.ok(built);

  const factTypes = ["capitals", "currencies", "languages", "population"];
  const collections = await Promise.all(
    factTypes.map(
      async (factType) =>
        JSON.parse(
          await readFile(
            join(built.outputDirectory, `facts/${factType}.json`),
            "utf8",
          ),
        ) as {
          factType: string;
          records: {
            entityKey: string;
            gap: boolean;
            reason?: string;
            value?: unknown;
          }[];
        },
    ),
  );

  // The guard that would have caught it: nothing published as a fact is
  // empty, whatever the source said.
  for (const collection of collections) {
    for (const record of collection.records) {
      if (record.gap) {
        continue;
      }
      const value = record.value;
      const isEmpty =
        value === null ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === "string" && value.length === 0) ||
        (typeof value === "object" &&
          !Array.isArray(value) &&
          Object.keys(value).length === 0);
      assert.ok(
        !isEmpty,
        `${collection.factType} publishes an empty value for ${record.entityKey}`,
      );
    }
  }

  // A source that answers "none" has answered: the entity does not have the
  // thing, which is a different statement from the source coming up short.
  for (const collection of collections) {
    assert.deepEqual(
      collection.records.find(
        ({ entityKey }) => entityKey === "area.antarctica",
      ),
      { entityKey: "area.antarctica", gap: true, reason: "not_applicable" },
      `${collection.factType} should record Antarctica as not applicable`,
    );
  }

  // Declared, so it passes; the record stays so the decision is visible.
  assert.deepEqual(built.reports.factlessEntities, [
    { entityKey: "area.antarctica", undeclared: [], blocking: false },
  ]);
  assert.ok(built.reports.factlessEntities.every(({ blocking }) => !blocking));
});

void test("every published asset offers a representation that decodes into an image", async () => {
  const [bundle] = await buildOfflineBundleTwice();
  assert.ok(bundle);
  const registry = JSON.parse(
    await readFile(join(bundle.outputDirectory, "assets/assets.json"), "utf8"),
  ) as {
    assets: {
      key: string;
      representations: {
        path: string;
        mimeType: string;
        sha256: string;
        scale?: number;
        widthPx?: number;
        heightPx?: number;
      }[];
    }[];
  };

  assert.equal(registry.assets.length, 250);
  for (const asset of registry.assets) {
    // The vector stays first so a client that can draw it keeps the sharper
    // file; the raster exists for the ones that cannot, which is every iOS
    // version the app supports.
    assert.equal(
      asset.representations.at(0)?.mimeType,
      "image/svg+xml",
      `${asset.key} does not lead with its vector original`,
    );
    const raster = asset.representations.filter(
      ({ mimeType }) => mimeType === "image/png",
    );
    assert.deepEqual(
      raster.map(({ scale }) => scale),
      [2, 3],
      `${asset.key} does not publish both raster scales in ascending order`,
    );

    for (const representation of asset.representations) {
      const bytes: Buffer = await readFile(
        join(bundle.outputDirectory, representation.path),
      );
      assert.equal(
        sha256(bytes),
        representation.sha256,
        `${representation.path} does not match the checksum a client verifies`,
      );
      if (representation.mimeType !== "image/png") {
        continue;
      }
      assert.deepEqual(decodePng(bytes, representation.path), {
        width: representation.widthPx,
        height: representation.heightPx,
      });
    }
  }
});

void test("network adapters expose pinned source metadata", async () => {
  const registry = await loadRegistry(pipelineRoot);
  for (const source of registry.sources) {
    assert.notEqual(source.revision, "latest");
    assert.match(source.sha256, /^[a-f0-9]{64}$/u);
    assert.ok(source.license.length > 0);
  }
});

void test("World Bank parser reduces an API response to the pinned snapshot set", async () => {
  const registry = await loadRegistry(pipelineRoot);
  const source = registry.sources.find(({ key }) => key === "world-bank");
  assert.ok(source);
  const current = {
    selectedIsoAlpha3: ["FRA"],
    records: [{ isoAlpha3: "FRA", value: 1 }],
  };
  const snapshot = sourceAdapter(source).parse(
    [
      { page: 1 },
      [
        { countryiso3code: "FRA", date: "2024", value: 68_551_653 },
        { countryiso3code: "WLD", date: "2024", value: 8_000_000_000 },
      ],
    ],
    source,
    current,
  ) as { records: { isoAlpha3: string }[]; year: number };
  assert.deepEqual(snapshot, {
    indicator: "SP.POP.TOTL",
    records: [{ isoAlpha3: "FRA", value: 68_551_653 }],
    selectedIsoAlpha3: ["FRA"],
    year: 2024,
  });
});

void test("pull retries rate limits and never overwrites an unexpected checksum", async () => {
  const root = await mkdtemp(join(tmpdir(), "country-flags-pull-"));
  const snapshotPath = join(root, "sources/snapshots/world-bank.json");
  const expectedSnapshot = {
    indicator: "SP.POP.TOTL",
    records: [{ isoAlpha3: "FRA", value: 68_551_653 }],
    year: 2024,
  };
  const unexpectedSnapshot = {
    ...expectedSnapshot,
    records: [{ isoAlpha3: "FRA", value: 1 }],
  };
  const originalFetch = globalThis.fetch;
  try {
    await mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, stableJson(expectedSnapshot), "utf8");
    await writeFile(
      join(root, "sources/registry.json"),
      stableJson({
        schemaVersion: 1,
        sources: [
          {
            key: "world-bank",
            adapter: "world-bank",
            url: "https://api.worldbank.org/pinned-fixture",
            revision: "fixture-v1",
            retrievedAt: "2026-07-28T00:00:00.000Z",
            license: "CC-BY-4.0",
            snapshotPath: "sources/snapshots/world-bank.json",
            sha256: sha256(stableJson(expectedSnapshot)),
          },
        ],
      }),
      "utf8",
    );
    let calls = 0;
    globalThis.fetch = (): Promise<Response> => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? new Response("rate limited", { status: 429 })
          : Response.json(unexpectedSnapshot),
      );
    };

    await assert.rejects(
      pullSource(root, "world-bank", "fixture-v1"),
      /upstream changed at pinned revision/u,
    );
    assert.equal(calls, 2);
    assert.equal(
      await readFile(snapshotPath, "utf8"),
      stableJson(expectedSnapshot),
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
