import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { sanitizeSvg } from "@country-flags/asset-core";

import type { EditorialAssetOverrideCandidate } from "./merge.js";
import type { EditorialAssetOverride, Provenance } from "./types.js";

export const ASSET_OVERRIDE_DIRECTORY = "editorial/overrides/assets";

export function assetOverridePath(entityKey: string): string {
  return `${ASSET_OVERRIDE_DIRECTORY}/${entityKey}.svg`;
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
      const path = assetOverridePath(override.entityKey);
      let svg: string;
      try {
        svg = await readFile(join(root, path), "utf8");
      } catch {
        throw new Error(
          `asset override for ${override.entityKey} declares ${path}, which does not exist`,
        );
      }
      return {
        entityKey: override.entityKey,
        reason: override.reason,
        candidate: {
          entity: { editorialKey: override.entityKey },
          upstreamPath: path,
          svg: sanitizeSvg(svg),
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
