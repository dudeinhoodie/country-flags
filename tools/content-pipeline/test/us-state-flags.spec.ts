import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { normalizeSource } from "../src/adapters.js";
import { loadRegistry, loadVerifiedSnapshot } from "../src/registry.js";
import { sha256 } from "../src/stable-json.js";
import type { SourceDefinition } from "../src/types.js";

// The suite runs from `dist/test`, so the package root is two levels up
// rather than one: the registry and its snapshots are not compiled.
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const source: SourceDefinition = {
  adapter: "us-state-flags",
  key: "us-state-flags",
  url: "https://commons.wikimedia.org/wiki/Category:SVG_flags_of_states_of_the_United_States",
  revision: "snapshot-test",
  retrievedAt: "2026-09-11T00:00:00.000Z",
  license: "Per-file, recorded per asset",
  snapshotPath: "sources/snapshots/us-state-flags.json",
  sha256: "",
};

function asset(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    aspectRatio: 1.5,
    attribution: "Benny Benson",
    attributionRequired: false,
    commonsTitle: "File:Flag of Alaska.svg",
    editorialKey: "subdivision.us.alaska",
    isoSubdivision: "US-AK",
    license: "pd",
    licenseName: "Public domain",
    sha1: "2b87f6468b49810b6af02983a6496c5a5d5670d2",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"/>',
    url: "https://upload.wikimedia.org/wikipedia/commons/e/e6/Flag_of_Alaska.svg",
    ...overrides,
  };
}

test("a state flag is addressed as a subdivision, never as a country", () => {
  const { assets } = normalizeSource({ assets: [asset()] }, source);
  assert.equal(assets.length, 1);
  const [candidate] = assets;
  assert.ok(candidate);
  // The whole point of ADR-020: a state code in `isoAlpha2` would put
  // California everywhere a reader expects a country.
  assert.deepEqual(candidate.entity, { isoSubdivision: "US-AK" });
  assert.equal(candidate.assetType, "flag");
  assert.equal(candidate.upstreamPath, "File:Flag of Alaska.svg");
});

test("the licence recorded is the file's own, not the source's", () => {
  const { assets } = normalizeSource({ assets: [asset()] }, source);
  const [candidate] = assets;
  assert.ok(candidate);
  // `source.license` says "per-file"; the asset must carry what Commons says
  // about this drawing, which is what a paid deck has to be able to show.
  assert.equal(candidate.license, "Public domain");
  assert.equal(candidate.attribution, "Benny Benson");
  assert.equal(candidate.provenance.sourceKey, "us-state-flags");
});

test("a licence outside the accepted set stops the source rather than shipping", () => {
  // Mississippi's file is "Copyrighted free use" with an insignia
  // restriction (#411). It must fail loudly, because the failure mode this
  // guards is the quiet one: a paid deck shipping a drawing whose terms
  // nobody read.
  assert.throws(
    () =>
      normalizeSource(
        {
          assets: [
            asset({
              commonsTitle: "File:Flag of Mississippi.svg",
              isoSubdivision: "US-MS",
              license: "copyrighted free use",
              licenseName: "Copyrighted free use",
            }),
          ],
        },
        source,
      ),
    /Flag of Mississippi\.svg carries licence "copyrighted free use"/u,
  );
});

test("the committed snapshot is the forty-nine states it claims to be", async () => {
  const registry = await loadRegistry(root);
  const definition = registry.sources.find(
    ({ key }) => key === "us-state-flags",
  );
  assert.ok(definition, "the registry must carry the source");

  // Reads through the checksum the registry pins, so a snapshot edited by
  // hand fails here rather than at publish time.
  const snapshot = await loadVerifiedSnapshot<{
    assets: { isoSubdivision: string; license: string; svg: string }[];
  }>(root, definition);

  assert.equal(snapshot.assets.length, 49);
  const codes = snapshot.assets.map(({ isoSubdivision }) => isoSubdivision);
  assert.equal(new Set(codes).size, 49, "every state appears exactly once");
  assert.ok(!codes.includes("US-MS"), "Mississippi is excluded until #411");
  assert.deepEqual(
    [...codes].sort((left, right) => left.localeCompare(right, "en")),
    codes,
    "the snapshot stays sorted so a diff is readable",
  );

  for (const entry of snapshot.assets) {
    assert.ok(
      entry.license === "pd" || entry.license === "cc0",
      `${entry.isoSubdivision} carries ${entry.license}`,
    );
    assert.ok(entry.svg.includes("<svg"), `${entry.isoSubdivision} has no SVG`);
  }

  const { assets } = normalizeSource(snapshot, definition);
  assert.equal(assets.length, 49);
});

test("the snapshot on disk is the bytes the registry signed", async () => {
  const registry = await loadRegistry(root);
  const definition = registry.sources.find(
    ({ key }) => key === "us-state-flags",
  );
  assert.ok(definition);
  const content = await readFile(join(root, definition.snapshotPath));
  assert.equal(sha256(content), definition.sha256);
});
