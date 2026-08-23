import type { Prisma } from "@prisma/client";

import {
  ASSET_REPRESENTATIONS_INCLUDE,
  mapAssetRepresentations,
} from "../content/asset-representations";

export const ADMIN_ASSET_INCLUDE = {
  ...ASSET_REPRESENTATIONS_INCLUDE,
  source: true,
} satisfies Prisma.AssetInclude;

export type AdminAsset = Prisma.AssetGetPayload<{
  include: typeof ADMIN_ASSET_INCLUDE;
}>;

type EntityName = {
  locale: string;
  nameType: string;
  value: string;
  isPrimary: boolean;
};

export function primaryName(
  names: EntityName[],
  locale: string,
): string | null {
  return (
    names.find((name) => name.isPrimary && name.locale.toLowerCase() === locale)
      ?.value ?? null
  );
}

/**
 * Unlike the client payload, the admin view keeps provenance next to the
 * image: an editor deciding whether to replace a flag needs the license and
 * the source, not only the pixels.
 */
export function mapAdminAsset(asset: AdminAsset): Record<string, unknown> {
  return {
    id: asset.id,
    type: asset.assetType,
    variant: asset.variant,
    width: asset.width,
    height: asset.height,
    aspectRatio:
      asset.aspectRatio === null ? null : asset.aspectRatio.toNumber(),
    licenseName: asset.licenseName,
    licenseUrl: asset.licenseUrl,
    attribution: asset.attribution,
    source: { name: asset.source.name, url: asset.source.url },
    representations: mapAssetRepresentations(asset),
  };
}
