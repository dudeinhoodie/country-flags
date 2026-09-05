import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { inspectPng, sanitizeSvg } from "@country-flags/asset-core";

import type { EditorialAssetOverrideCandidate } from "./merge.js";
import type {
  EditorialAssetOverride,
  EditorialAssetType,
  Provenance,
} from "./types.js";
import { DEFAULT_ASSET_VARIANT } from "./editorial-schema.js";

export const ASSET_OVERRIDE_DIRECTORY = "editorial/overrides/assets";

/**
 * Where an override's drawing lives.
 *
 * The type and the variant are part of the path because one entity now has
 * several symbols: under the old flat name a coat of arms and a flag would
 * have fought over one file, and whichever was written last would have won
 * silently.
 */
export function assetOverridePath(
  entityKey: string,
  assetType: EditorialAssetType,
  variant: string,
  extension: "svg" | "png" = "svg",
): string {
  return `${ASSET_OVERRIDE_DIRECTORY}/${entityKey}/${assetType}/${variant}.${extension}`;
}

/**
 * Where a v2 document's drawing lives.
 *
 * A catalog written before the typed layout names one flag per entity and
 * its files are still flat on disk. Both are read until the document itself
 * is written as v3 (#314); nothing is moved by a lift that happens in memory.
 */
export function legacyAssetOverridePath(
  entityKey: string,
  extension: "svg" | "png" = "svg",
): string {
  return `${ASSET_OVERRIDE_DIRECTORY}/${entityKey}.${extension}`;
}

function candidatePaths(
  override: EditorialAssetOverride,
  extension: "svg" | "png",
): string[] {
  const typed = assetOverridePath(
    override.entityKey,
    override.assetType,
    override.variant,
    extension,
  );
  if (
    override.assetType !== "flag" ||
    override.variant !== DEFAULT_ASSET_VARIANT
  ) {
    return [typed];
  }
  return [typed, legacyAssetOverridePath(override.entityKey, extension)];
}

async function firstExisting(
  root: string,
  paths: string[],
): Promise<{ path: string; bytes: Buffer } | null> {
  for (const path of paths) {
    const bytes = await readOptional(join(root, path));
    if (bytes !== null) {
      return { path, bytes };
    }
  }
  return null;
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
      const [vector, raster] = await Promise.all([
        firstExisting(root, candidatePaths(override, "svg")),
        firstExisting(root, candidatePaths(override, "png")),
      ]);
      if (vector !== null && raster !== null) {
        throw new Error(
          `asset override for ${override.entityKey} has both ${vector.path} and ${raster.path}; keep exactly one`,
        );
      }
      let drawing:
        | { png: Buffer; upstreamPath: string }
        | { svg: string; upstreamPath: string };
      if (vector !== null) {
        drawing = {
          svg: sanitizeSvg(vector.bytes.toString("utf8")),
          upstreamPath: vector.path,
        };
      } else if (raster !== null) {
        // Fail here, where the file is named, rather than inside the build:
        // the bytes decide what they are, not the extension.
        inspectPng(raster.bytes);
        drawing = { png: raster.bytes, upstreamPath: raster.path };
      } else {
        throw new Error(
          `asset override for ${override.entityKey} declares ${assetOverridePath(
            override.entityKey,
            override.assetType,
            override.variant,
          )} (or .png), which does not exist`,
        );
      }
      return {
        entityKey: override.entityKey,
        reason: override.reason,
        candidate: {
          entity: { editorialKey: override.entityKey },
          assetType: override.assetType,
          variant: override.variant,
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
