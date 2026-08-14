// Copies the flags of one content release into the app.
//
// The client draws a bundled flag when the checksum of a published
// representation matches one this build ships, so the index is keyed by the
// checksum of every encoding the release published — vector and raster alike.
// A corrected flag has different bytes, none of its checksums match, and the
// client downloads it. See docs/adr/ADR-011-bundled-flag-baseline.md.
//
//   node ios/Scripts/sync-flag-assets.mjs           update the bundled set
//   node ios/Scripts/sync-flag-assets.mjs --check   fail when it is stale (CI)

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/// The release this build ships. A binary must never carry images no release
/// published, so the set and the version are generated together from one
/// directory.
const CONTENT_VERSION = "fixture-v1";

const bundleDirectory = join(
  repositoryRoot,
  "content/generated",
  CONTENT_VERSION,
);
const resourcesDirectory = join(
  repositoryRoot,
  "ios/CountryFlagsKit/Sources/CountryFlagsFeatures/Resources",
);
const catalogDirectory = join(resourcesDirectory, "Flags.xcassets");
const indexPath = join(resourcesDirectory, "BundledFlags.json");

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assetName(path) {
  const slug = path.replace(/^assets\/svg\//u, "").replace(/\.svg$/u, "");
  return `flag-${slug}`;
}

async function readRegistry() {
  const registry = JSON.parse(
    await readFile(join(bundleDirectory, "assets/assets.json"), "utf8"),
  );
  return registry.assets.sort((left, right) => left.key.localeCompare(right.key, "en"));
}

/// Removes the letterbox clip most flag-icons files carry.
///
/// Xcode's SVG renderer applies a clipPath in the file's root coordinate
/// space, ignoring the transform of the group that references it. The
/// letterbox clip is written in pre-transform units, so on part of the set
/// Xcode cut a strip off the flag — seven percent of Israel, a tenth of
/// Benin, a quarter of Libya — and the card showed the ground where the
/// flag should have been. The clip is redundant for this use anyway: the
/// viewBox already crops the canvas.
///
/// A letterbox is recognised by its shape: a clipPath holding a plain
/// rectangle, drawn as a path of straight lines or as a rect element. A
/// clip of any other shape is content — Belarus masks its ornament with
/// one, Nicaragua its emblem — and is kept.
function stripLetterboxClip(svg) {
  const asPath = svg.match(
    /<clipPath id="([a-z0-9-]+)"><path [^>]*?d="([^"]+)"[^>]*\/><\/clipPath>/u,
  );
  const asRect = svg.match(/<clipPath id="([a-z0-9-]+)"><rect [^>]*\/><\/clipPath>/u);
  const rectangle = /^[Mm]-?[\d.]+[, ]?-?[\d.]+(?:[HhVv]-?[\d.]+)+[zZ]$/u;
  const definition =
    asPath !== null && rectangle.test(asPath[2]) ? asPath : asRect;
  if (definition === null) {
    return svg;
  }
  return svg
    .replace(definition[0], "")
    .replace("<defs></defs>", "")
    .replaceAll(` clip-path="url(#${definition[1]})"`, "");
}

/// The catalog holds the vector original: an asset catalog preserves its vector
/// data, so one file stays sharp at every size and costs less than the raster
/// set it replaces.
async function buildCatalog(assets, directory) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "Contents.json"),
    stableJson({ info: { author: "xcode", version: 1 } }),
  );

  for (const asset of assets) {
    const vector = asset.representations.find(
      ({ mimeType }) => mimeType === "image/svg+xml",
    );
    if (vector === undefined) {
      throw new Error(`${asset.key} publishes no vector original`);
    }
    const name = assetName(vector.path);
    const imageset = join(directory, `${name}.imageset`);
    const fileName = vector.path.split("/").at(-1);
    await mkdir(imageset, { recursive: true });
    await writeFile(
      join(imageset, fileName),
      stripLetterboxClip(await readFile(join(bundleDirectory, vector.path), "utf8")),
    );
    await writeFile(
      join(imageset, "Contents.json"),
      stableJson({
        images: [{ filename: fileName, idiom: "universal" }],
        info: { author: "xcode", version: 1 },
        properties: { "preserves-vector-representation": true },
      }),
    );
  }
}

function buildIndex(assets) {
  const assetNames = {};
  for (const asset of assets) {
    const vector = asset.representations.find(
      ({ mimeType }) => mimeType === "image/svg+xml",
    );
    const name = assetName(vector.path);
    // Every encoding points at the same image: the client stores whichever
    // representation it chose, and the lookup has to hit for all of them.
    //
    // Territories that fly an identical file share a checksum — Heard Island
    // under the Australian flag, Bonaire under the Dutch one. Identical bytes
    // are the identical picture, so collapsing them onto one entry draws the
    // same flag either way, and iterating in key order keeps which one it is
    // stable across runs.
    for (const representation of asset.representations) {
      assetNames[representation.sha256] = name;
    }
  }
  return {
    contentVersion: CONTENT_VERSION,
    assetNames: Object.fromEntries(
      Object.entries(assetNames).sort(([left], [right]) =>
        left.localeCompare(right, "en"),
      ),
    ),
  };
}

async function hashDirectory(directory) {
  const hash = createHash("sha256");
  const visit = async (path, relativePath = "") => {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name, "en"),
    )) {
      const child = join(path, entry.name);
      const childRelative = join(relativePath, entry.name);
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

const checkOnly = process.argv.includes("--check");
const assets = await readRegistry();
const index = stableJson(buildIndex(assets));

if (checkOnly) {
  const staging = join(resourcesDirectory, ".Flags.xcassets.check");
  try {
    await buildCatalog(assets, staging);
    const [expected, actual] = await Promise.all([
      hashDirectory(staging),
      hashDirectory(catalogDirectory).catch(() => ""),
    ]);
    const currentIndex = await readFile(indexPath, "utf8").catch(() => "");
    if (expected !== actual || currentIndex !== index) {
      process.stderr.write(
        "::error::The bundled flag set is stale. Run ios/Scripts/sync-flag-assets.mjs and commit the result.\n",
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(
        `The bundled flag set matches ${CONTENT_VERSION}.\n`,
      );
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
} else {
  await rm(catalogDirectory, { recursive: true, force: true });
  await buildCatalog(assets, catalogDirectory);
  await writeFile(indexPath, index);
  process.stdout.write(
    `Bundled ${String(assets.length)} flags from ${CONTENT_VERSION}.\n`,
  );
}
