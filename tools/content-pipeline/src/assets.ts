import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertAspectRatioMatchesViewBox,
  RASTER_SCALES,
  renderRaster,
  sanitizeSvg,
  sha256,
} from "@country-flags/asset-core";

import type { AssetCandidate, Provenance } from "./types.js";

// Sanitizing, rasterizing and hashing live in @country-flags/asset-core so
// the admin console's upload path runs the very same checks; a second
// sanitizer would be a second security boundary.
export { renderRaster, sanitizeSvg };

export interface AssetRepresentation {
  path: string;
  mimeType: "image/svg+xml" | "image/png";
  /// Of the bytes this representation serves, not of the asset: a client
  /// verifies what it downloaded, and the vector checksum cannot vouch for a
  /// raster.
  sha256: string;
  scale?: number;
  widthPx?: number;
  heightPx?: number;
}

export interface BuiltAsset {
  key: string;
  entityKey: string;
  /// Ordered by client preference: the vector original, then raster by
  /// ascending scale.
  ///
  /// The only place an encoding is described. The asset used to repeat the
  /// vector's own path, media type and checksum beside this list, so that a
  /// reader written before the list existed kept working; nothing reads them
  /// any more.
  representations: AssetRepresentation[];
  aspectRatio: number;
  sourcePath: string;
  license: string;
  attribution: string;
  provenance: Provenance;
  validFrom: string | null;
  validTo: string | null;
}

export async function buildAsset(
  outputDirectory: string,
  entityKey: string,
  candidate: AssetCandidate,
): Promise<BuiltAsset> {
  if (candidate.license.trim().length === 0) {
    throw new Error(`${entityKey} asset has no approved license`);
  }
  const svg = sanitizeSvg(candidate.svg);
  assertAspectRatioMatchesViewBox(
    svg,
    candidate.aspectRatio,
    `${entityKey} asset`,
  );
  const slug = entityKey.replace(/^(?:area|country|territory)\./u, "");
  const relativePath = `assets/svg/${slug}.svg`;
  await mkdir(join(outputDirectory, "assets/svg"), { recursive: true });
  await writeFile(join(outputDirectory, relativePath), svg, "utf8");

  // Raster is rendered from the sanitized bytes that were just published, so
  // the PNG can never depict something the vector does not.
  await mkdir(join(outputDirectory, "assets/png"), { recursive: true });
  const raster: AssetRepresentation[] = [];
  for (const scale of RASTER_SCALES) {
    const { png, widthPx, heightPx } = renderRaster(svg, scale);
    const rasterPath = `assets/png/${slug}@${String(scale)}x.png`;
    await writeFile(join(outputDirectory, rasterPath), png);
    raster.push({
      path: rasterPath,
      mimeType: "image/png",
      sha256: sha256(png),
      scale,
      widthPx,
      heightPx,
    });
  }

  return {
    key: `flag.${slug}.current`,
    entityKey,
    representations: [
      { path: relativePath, mimeType: "image/svg+xml", sha256: sha256(svg) },
      ...raster,
    ],
    aspectRatio: candidate.aspectRatio,
    sourcePath: candidate.upstreamPath,
    license: candidate.license,
    attribution: candidate.attribution ?? "lipis/flag-icons contributors",
    provenance: candidate.provenance,
    validFrom: candidate.validFrom ?? null,
    validTo: candidate.validTo ?? null,
  };
}
