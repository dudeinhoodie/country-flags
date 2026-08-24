import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { inspectPng, sanitizeSvg } from "@country-flags/asset-core";

import type { EditorialAssetOverrideCandidate } from "./merge.js";
import type { EditorialAssetOverride, Provenance } from "./types.js";

export const ASSET_OVERRIDE_DIRECTORY = "editorial/overrides/assets";

export function assetOverridePath(
  entityKey: string,
  extension: "svg" | "png" = "svg",
): string {
  return `${ASSET_OVERRIDE_DIRECTORY}/${entityKey}.${extension}`;
}

async function readOptional(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

/**
 * Reads the drawings the editorial layer supplies for itself.
 *
 * The metadata lives in the catalog and the bytes live beside it, because a
 * published asset needs a license and a source no matter who chose it — an
 * override without provenance would publish an image nobody can account for.
 * A declared override whose file is missing is an error rather than a
 * silently skipped record: the catalog would otherwise claim a replacement
 * that never happens.
 *
 * A drawing is one file, `.svg` or `.png`: a vector is preferred, but an
 * editor may only have a raster, and refusing it would keep a wrong flag
 * published. Both files at once is an error — nothing could say which one
 * the override means.
 */
export async function loadAssetOverrides(
  root: string,
  overrides: EditorialAssetOverride[] | undefined,
  provenance: Provenance,
): Promise<EditorialAssetOverrideCandidate[]> {
  if (overrides === undefined || overrides.length === 0) {
    return [];
  }
  return Promise.all(
    overrides.map(async (override) => {
      const svgPath = assetOverridePath(override.entityKey, "svg");
      const pngPath = assetOverridePath(override.entityKey, "png");
      const [svgBytes, pngBytes] = await Promise.all([
        readOptional(join(root, svgPath)),
        readOptional(join(root, pngPath)),
      ]);
      if (svgBytes !== null && pngBytes !== null) {
        throw new Error(
          `asset override for ${override.entityKey} has both ${svgPath} and ${pngPath}; keep exactly one`,
        );
      }
      let drawing:
        | { png: Buffer; upstreamPath: string }
        | { svg: string; upstreamPath: string };
      if (svgBytes !== null) {
        drawing = {
          svg: sanitizeSvg(svgBytes.toString("utf8")),
          upstreamPath: svgPath,
        };
      } else if (pngBytes !== null) {
        // Fail here, where the file is named, rather than inside the build:
        // the bytes decide what they are, not the extension.
        inspectPng(pngBytes);
        drawing = { png: pngBytes, upstreamPath: pngPath };
      } else {
        throw new Error(
          `asset override for ${override.entityKey} declares ${svgPath} (or .png), which does not exist`,
        );
      }
      return {
        entityKey: override.entityKey,
        reason: override.reason,
        candidate: {
          entity: { editorialKey: override.entityKey },
          ...drawing,
          aspectRatio: override.aspectRatio,
          provenance,
          license: override.license,
          ...(override.attribution === undefined
            ? {}
            : { attribution: override.attribution }),
          ...(override.validFrom === undefined
            ? {}
            : { validFrom: override.validFrom }),
          ...(override.validTo === undefined
            ? {}
            : { validTo: override.validTo }),
        },
      };
    }),
  );
}
