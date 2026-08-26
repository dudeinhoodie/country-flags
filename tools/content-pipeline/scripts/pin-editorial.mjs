// Re-pins the editorial snapshot checksum after the catalog changed.
//
// The registry pins the sha256 of editorial/catalog.json and the build
// refuses a catalog whose bytes moved: an unexplained edit must fail
// loudly. A deliberate edit — a merged console proposal, or a hand edit —
// therefore has to update the pin, and this script is the one way to do
// it: it recomputes the checksum, advances the editorial revision, and
// stamps when the pin moved. It changes nothing when the pin already
// matches, so running it twice is safe.
//
//   node tools/content-pipeline/scripts/pin-editorial.mjs

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const catalogPath = join(root, "editorial/catalog.json");
const registryPath = join(root, "sources/registry.json");

const catalogSha = createHash("sha256")
  .update(await readFile(catalogPath))
  .digest("hex");

const registry = JSON.parse(await readFile(registryPath, "utf8"));
const editorial = registry.sources.find((source) => source.key === "editorial");
if (editorial === undefined) {
  throw new Error("sources/registry.json has no editorial entry");
}

if (editorial.sha256 === catalogSha) {
  process.stdout.write("Editorial snapshot checksum already pinned\n");
  process.exit(0);
}

const revisionMatch = /^editorial-v(\d+)$/.exec(editorial.revision ?? "");
if (revisionMatch === null) {
  throw new Error(
    `Editorial revision "${String(editorial.revision)}" is not editorial-v<n>; re-pin it by hand`,
  );
}

const previous = editorial.revision;
editorial.revision = `editorial-v${String(Number(revisionMatch[1]) + 1)}`;
editorial.sha256 = catalogSha;
editorial.retrievedAt = new Date().toISOString();

await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
process.stdout.write(
  `Pinned editorial snapshot ${catalogSha} (${previous} -> ${editorial.revision})\n`,
);
