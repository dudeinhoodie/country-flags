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

import { Resvg } from "@resvg/resvg-js";

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

/// The sizes the catalog carries. The largest surface a flag fills is the
/// details sheet, about 370 points wide, so 1080 pixels covers a 3x screen
/// with headroom and 720 a 2x one. There is no 1x slot: no supported device
/// has a 1x screen.
const SCALES = [
  { scale: "2x", width: 720 },
  { scale: "3x", width: 1080 },
];

/// Renders the release's own SVG bytes to pixels.
///
/// resvg, not Xcode: the asset catalog's SVG support implements a sliver of
/// the format and drew part of this set wrong — clips applied in the wrong
/// coordinate space, mishandled masks and patterns on every flag with a
/// crest. Rasterising with a complete renderer at build time retires that
/// class of bug for all 250 flags at once, and lets the release bytes ship
/// untouched instead of being patched around one parser.
function rasterize(svg, width) {
  const renderer = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    // Deterministic output: the check mode re-renders and compares bytes,
    // so nothing machine-local may leak into them. Flags carry no text.
    font: { loadSystemFonts: false },
  });
  return renderer.render().asPng();
}

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
    await mkdir(imageset, { recursive: true });
    const svg = await readFile(join(bundleDirectory, vector.path), "utf8");
    const images = [];
    for (const { scale, width } of SCALES) {
      const fileName = `${name}@${scale}.png`;
      await writeFile(join(imageset, fileName), rasterize(svg, width));
      images.push({ filename: fileName, idiom: "universal", scale });
    }
    await writeFile(
      join(imageset, "Contents.json"),
      stableJson({
        images,
        info: { author: "xcode", version: 1 },
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
