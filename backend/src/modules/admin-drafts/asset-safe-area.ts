import {
  RASTER_BASE_HEIGHT_PT,
  RASTER_SCALES,
} from "@country-flags/asset-core";
import type { ImageInspection } from "@country-flags/asset-core";
import { AssetType } from "@prisma/client";

/**
 * What a drawing has to be before a card can fit it.
 *
 * The sanitizer and the byte inspection live in `@country-flags/asset-core`
 * and decide whether the file is safe and what it is; this module asks the
 * next question, which the upload path used to skip: will the drawing still
 * be legible once a card lays it out?
 *
 * The distinction matters most for a coat of arms. A flag is a rectangle and
 * fills its box; a coat is a device drawn on nothing, and its crown,
 * supporters and ribbon sit at the outer edge of its own bounds. Fitted into
 * a box whose proportions are nothing like its own it becomes a strip, and
 * the parts that identify it are the parts that disappear first. So the coat
 * is held to the aspect-fit safe area, and a drawing that will not say what
 * its proportions are is refused rather than guessed at.
 *
 * These are refusals the asset editor makes on its own, at upload. They are
 * not the READY/PUBLISH gate, which is a separate verdict over the whole
 * draft.
 */

/** The tallest a card draws a symbol, on the densest screen the app runs on. */
const MINIMUM_RASTER_HEIGHT_PX =
  RASTER_BASE_HEIGHT_PT * Math.max(...RASTER_SCALES);

/**
 * Beyond this a raster is not a better drawing, only a heavier one, and the
 * client decodes every pixel of it to draw a thumbnail.
 */
const MAXIMUM_RASTER_EDGE_PX = 8192;

/**
 * How far a coat's proportions may stray from its box before aspect-fit
 * turns it into a sliver. Real arms run from tall-and-narrow to a wide
 * achievement with supporters and a ribbon — roughly 1:2 to 2:1 — so the
 * band is set well outside that: what it catches is a drawing that is not
 * shaped like arms at all, most often a flag filed under the wrong type.
 */
const COAT_OF_ARMS_MINIMUM_RATIO = 1 / 3;
const COAT_OF_ARMS_MAXIMUM_RATIO = 3;

/** A root `preserveAspectRatio="none"` throws away aspect-fit entirely. */
const DISTORTING_PRESERVE_ASPECT_RATIO =
  /<svg\b[^>]*\bpreserveAspectRatio\s*=\s*["']\s*none\s*["']/iu;

export interface AssetRefusal {
  code: string;
  message: string;
}

/**
 * The refusal this drawing earns, or null when a card can lay it out.
 *
 * One verdict rather than a list: the editor fixes one thing and uploads
 * again, and the first fault is the one worth naming.
 */
export function inspectSafeArea(
  assetType: AssetType,
  inspection: ImageInspection,
): AssetRefusal | null {
  if (inspection.aspectRatio === null) {
    return {
      code: "ASSET_ASPECT_UNDECLARED",
      message:
        "The drawing does not declare its proportions. Give the SVG a viewBox: aspect-fit has no box to fit without one.",
    };
  }
  if (
    inspection.svg !== undefined &&
    DISTORTING_PRESERVE_ASPECT_RATIO.test(inspection.svg)
  ) {
    return {
      code: "ASSET_ASPECT_DISTORTED",
      message:
        'The drawing sets preserveAspectRatio="none", which stretches it to whatever box it lands in.',
    };
  }
  if (
    inspection.heightPx !== null &&
    inspection.heightPx < MINIMUM_RASTER_HEIGHT_PX
  ) {
    return {
      code: "ASSET_PIXELS_TOO_SMALL",
      message: `The image is ${String(inspection.heightPx)} pixels tall; a card draws it ${String(MINIMUM_RASTER_HEIGHT_PX)}.`,
    };
  }
  if (
    (inspection.widthPx !== null &&
      inspection.widthPx > MAXIMUM_RASTER_EDGE_PX) ||
    (inspection.heightPx !== null &&
      inspection.heightPx > MAXIMUM_RASTER_EDGE_PX)
  ) {
    return {
      code: "ASSET_PIXELS_TOO_LARGE",
      message: `The image is larger than ${String(MAXIMUM_RASTER_EDGE_PX)} pixels on a side; the client decodes all of it to draw a thumbnail.`,
    };
  }
  if (
    assetType === AssetType.COAT_OF_ARMS &&
    (inspection.aspectRatio < COAT_OF_ARMS_MINIMUM_RATIO ||
      inspection.aspectRatio > COAT_OF_ARMS_MAXIMUM_RATIO)
  ) {
    return {
      code: "COAT_OF_ARMS_ASPECT_UNSAFE",
      message: `The drawing is ${inspection.aspectRatio.toFixed(2)}:1. Fitted into a coat card it becomes a strip, and the crown, supporters and ribbon are what a strip loses.`,
    };
  }
  return null;
}

export const SAFE_AREA_LIMITS = {
  minimumRasterHeightPx: MINIMUM_RASTER_HEIGHT_PX,
  maximumRasterEdgePx: MAXIMUM_RASTER_EDGE_PX,
  coatOfArmsMinimumRatio: COAT_OF_ARMS_MINIMUM_RATIO,
  coatOfArmsMaximumRatio: COAT_OF_ARMS_MAXIMUM_RATIO,
} as const;
