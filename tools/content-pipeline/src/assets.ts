import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertAspectRatioMatchesViewBox,
  inspectPng,
  RASTER_SCALES,
  renderRaster,
  sanitizeSvg,
  sha256,
} from "@country-flags/asset-core";

import { DEFAULT_ASSET_VARIANT } from "./editorial-schema.js";
import type {
  AssetCandidate,
  EditorialAssetType,
  Provenance,
} from "./types.js";

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
  assetType: EditorialAssetType;
  variant: string;
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

/**
 * What a published drawing is called, and where its bytes go.
 *
 * A flag published before symbols were typed keeps the name it has always
 * had: renaming seven hundred files would say nothing about coats of arms,
 * and a release is immutable anyway. Every other type and variant carries
 * both in its name, which is what stops a coat of arms from overwriting the
 * flag of the same country.
 */
function assetIdentity(
  entityKey: string,
  assetType: EditorialAssetType,
  variant: string,
): { key: string; fileName: string } {
  const slug = entityKey.replace(
    /^(?:area|country|territory|subdivision)\./u,
    "",
  );
  const historical = assetType === "flag" && variant === DEFAULT_ASSET_VARIANT;
  return {
    key: `${assetType}.${slug}.${variant}`,
    fileName: historical
      ? slug
      : `${slug}.${assetType.replace(/_/gu, "-")}.${variant}`,
  };
}

export async function buildAsset(
  outputDirectory: string,
  entityKey: string,
  candidate: AssetCandidate,
): Promise<BuiltAsset> {
  if (candidate.license.trim().length === 0) {
    throw new Error(`${entityKey} asset has no approved license`);
  }
  if (candidate.svg === undefined) {
    return buildRasterOnlyAsset(outputDirectory, entityKey, candidate);
  }
  const svg = sanitizeSvg(candidate.svg);
  assertAspectRatioMatchesViewBox(
    svg,
    candidate.aspectRatio,
    `${entityKey} asset`,
  );
  const { key, fileName } = assetIdentity(
    entityKey,
    candidate.assetType,
    candidate.variant,
  );
  const relativePath = `assets/svg/${fileName}.svg`;
  await mkdir(join(outputDirectory, "assets/svg"), { recursive: true });
  await writeFile(join(outputDirectory, relativePath), svg, "utf8");

  // Raster is rendered from the sanitized bytes that were just published, so
  // the PNG can never depict something the vector does not.
  await mkdir(join(outputDirectory, "assets/png"), { recursive: true });
  const raster: AssetRepresentation[] = [];
  for (const scale of RASTER_SCALES) {
    const { png, widthPx, heightPx } = renderRaster(svg, scale);
    const rasterPath = `assets/png/${fileName}@${String(scale)}x.png`;
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
    key,
    entityKey,
    assetType: candidate.assetType,
    variant: candidate.variant,
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

/**
 * A raster-only editorial override: the editor supplied a PNG and no vector
 * exists, so none is invented. One representation, published at the file's
 * own pixel size and no declared screen scale — the client's fallback rule
 * ("whatever decodes at all") is exactly the case this shape exists for.
 */
async function buildRasterOnlyAsset(
  outputDirectory: string,
  entityKey: string,
  candidate: AssetCandidate,
): Promise<BuiltAsset> {
  const png = candidate.png;
  if (png === undefined) {
    throw new Error(`${entityKey} asset carries neither a vector nor a raster`);
  }
  const { widthPx, heightPx } = inspectPng(png);
  if (widthPx === null || heightPx === null) {
    throw new Error(`${entityKey} asset PNG declares no size`);
  }
  const actualRatio = widthPx / heightPx;
  if (Math.abs(actualRatio - candidate.aspectRatio) > 0.01) {
    throw new Error(
      `${entityKey} asset aspectRatio ${String(candidate.aspectRatio)} does not match the PNG's ${String(actualRatio)}`,
    );
  }
  const { key, fileName } = assetIdentity(
    entityKey,
    candidate.assetType,
    candidate.variant,
  );
  const relativePath = `assets/png/${fileName}.png`;
  await mkdir(join(outputDirectory, "assets/png"), { recursive: true });
  await writeFile(join(outputDirectory, relativePath), png);
  return {
    key,
    entityKey,
    assetType: candidate.assetType,
    variant: candidate.variant,
    representations: [
      {
        path: relativePath,
        mimeType: "image/png",
        sha256: sha256(png),
        widthPx,
        heightPx,
      },
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
