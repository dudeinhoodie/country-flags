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
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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
  const included = editorial.entities.filter(
    ({ includeInCountryCatalog }) => includeInCountryCatalog,
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
    schemaVersion: 1,
    defaultLocale: "ru",
    supportedLocales: ["ru", "en"],
    entities: [
      {
        key: "country.france",
        type: "country",
        status: "active",
        includeInCountryCatalog: true,
        recognitionStatus: "un_member",
        identifiers: { isoAlpha2: "FR" },
      },
      {
        key: "country.kosovo",
        type: "country",
        status: "active",
        includeInCountryCatalog: true,
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
  const firstRoot = await mkdtemp(join(tmpdir(), "country-flags-content-a-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "country-flags-content-b-"));
  try {
    const options = {
      root: pipelineRoot,
      catalogVersion: "deterministic-test-v1",
      publishReady: true,
    };
    const first = await buildBundle({ ...options, outputRoot: firstRoot });
    const second = await buildBundle({ ...options, outputRoot: secondRoot });

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
      population.records.find(
        ({ entityKey }) => entityKey === "country.kosovo",
      ),
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
  } finally {
    await rm(firstRoot, { recursive: true, force: true });
    await rm(secondRoot, { recursive: true, force: true });
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
