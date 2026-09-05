import type { ImageInspection } from "@country-flags/asset-core";
import { AssetType } from "@prisma/client";

import { inspectSafeArea, SAFE_AREA_LIMITS } from "./asset-safe-area";

const VIEW_BOX = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/u;

/** What `inspectImage` hands back for an SVG carrying these attributes. */
function svg(attributes: string): ImageInspection {
  const viewBox = VIEW_BOX.exec(attributes);
  return {
    mimeType: "image/svg+xml",
    widthPx: null,
    heightPx: null,
    aspectRatio:
      viewBox === null ? null : Number(viewBox[1]) / Number(viewBox[2]),
    svg: `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><path d="M0 0h1v1z"/></svg>`,
  };
}

function png(widthPx: number, heightPx: number): ImageInspection {
  return {
    mimeType: "image/png",
    widthPx,
    heightPx,
    aspectRatio: widthPx / heightPx,
  };
}

describe("inspectSafeArea", () => {
  it("passes an ordinary flag and an ordinary coat of arms", () => {
    expect(
      inspectSafeArea(AssetType.FLAG, svg('viewBox="0 0 3 2"')),
    ).toBeNull();
    expect(
      inspectSafeArea(AssetType.COAT_OF_ARMS, svg('viewBox="0 0 400 500"')),
    ).toBeNull();
    expect(inspectSafeArea(AssetType.FLAG, png(900, 600))).toBeNull();
  });

  it("refuses a drawing that will not say what shape it is", () => {
    // Aspect-fit has nothing to fit into without a viewBox, and the card
    // would be laying out a drawing whose proportions it had to guess.
    expect(inspectSafeArea(AssetType.FLAG, svg('width="30"'))).toMatchObject({
      code: "ASSET_ASPECT_UNDECLARED",
    });
  });

  it("refuses a drawing that opts out of aspect-fit", () => {
    expect(
      inspectSafeArea(
        AssetType.COAT_OF_ARMS,
        svg('viewBox="0 0 400 500" preserveAspectRatio="none"'),
      ),
    ).toMatchObject({ code: "ASSET_ASPECT_DISTORTED" });
  });

  it("refuses a raster smaller than a card draws it, and an oversized one", () => {
    expect(
      inspectSafeArea(
        AssetType.FLAG,
        png(120, SAFE_AREA_LIMITS.minimumRasterHeightPx - 1),
      ),
    ).toMatchObject({ code: "ASSET_PIXELS_TOO_SMALL" });
    expect(
      inspectSafeArea(
        AssetType.FLAG,
        png(SAFE_AREA_LIMITS.maximumRasterEdgePx + 1, 600),
      ),
    ).toMatchObject({ code: "ASSET_PIXELS_TOO_LARGE" });
  });

  it("holds a coat of arms to the safe area a flag does not need", () => {
    // The same banner-shaped drawing: legitimate as a flag, and as a coat
    // it is the shape whose crown, supporters and ribbon vanish when a
    // near-square card fits it.
    const banner = svg('viewBox="0 0 800 100"');
    expect(inspectSafeArea(AssetType.FLAG, banner)).toBeNull();
    expect(inspectSafeArea(AssetType.COAT_OF_ARMS, banner)).toMatchObject({
      code: "COAT_OF_ARMS_ASPECT_UNSAFE",
    });

    // Real arms run from tall and narrow to wide with supporters; the band
    // is set outside all of them.
    for (const ratio of ["400 800", "800 400", "500 500", "700 500"]) {
      expect(
        inspectSafeArea(AssetType.COAT_OF_ARMS, svg(`viewBox="0 0 ${ratio}"`)),
      ).toBeNull();
    }
  });
});
