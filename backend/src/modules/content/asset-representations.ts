import type { Prisma } from "@prisma/client";

/**
 * Assets are read together with every encoding they publish, in the order a
 * client should prefer them: the vector original first, then raster by
 * ascending scale.
 */
export const ASSET_REPRESENTATIONS_INCLUDE = {
  representations: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.AssetInclude;

export type AssetWithRepresentations = Prisma.AssetGetPayload<{
  include: typeof ASSET_REPRESENTATIONS_INCLUDE;
}>;

/**
 * @throws when the asset publishes nothing. A release cannot reach here in
 *   that state — the bundle validator rejects it and the contract requires at
 *   least one entry — so an empty list is a corrupted row rather than a case
 *   to serve around.
 */
export function mapAssetRepresentations(
  asset: AssetWithRepresentations,
): Record<string, unknown>[] {
  if (asset.representations.length === 0) {
    throw new Error(`Asset ${asset.id} publishes no representation`);
  }
  return asset.representations.map((representation) => ({
    url: representation.publicUrl,
    mimeType: representation.mimeType,
    sha256: representation.sha256,
    scale: representation.scale,
    widthPx: representation.widthPx,
    heightPx: representation.heightPx,
  }));
}
