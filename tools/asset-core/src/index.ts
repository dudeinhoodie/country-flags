/**
 * The one implementation of "turn submitted SVG bytes into something safe
 * enough to publish". Both callers use it: the content pipeline when it
 * builds a release, and the backend when an editor uploads a replacement
 * through the admin console. A second sanitizer would be a second security
 * boundary, and the weaker one would decide.
 *
 * Emitted as CommonJS so the ESM pipeline and the CommonJS backend can both
 * import it without a dual build.
 */
import { createHash } from "node:crypto";

import { Resvg } from "@resvg/resvg-js";

/** The study prompt draws a flag about this tall, the largest it appears. */
export const RASTER_BASE_HEIGHT_PT = 120;

/** Published screen scales: no device the app runs on has @1x. */
export const RASTER_SCALES = [2, 3] as const;

export class UnsafeAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeAssetError";
  }
}

const FORBIDDEN_SVG =
  /<!DOCTYPE|<!ENTITY|<(?:script|style|foreignObject|iframe|object|embed)\b|on[a-z]+\s*=|(?:href|src)\s*=\s*["'](?:https?:|data:|javascript:)|url\s*\(\s*["']?(?:https?:|data:|javascript:)/iu;

/**
 * The XML declaration a file may open with. It is a prolog rather than
 * content: it declares the encoding and nothing that renders.
 *
 * Dropped before anything is judged, because leaving it in refused ordinary
 * drawings twice over. `startsWith("<svg")` is false for every file that
 * carries one — four of the forty-nine U.S. state flags on Wikimedia do — and
 * `standalone="no"` inside it matches the rule against event handlers, whose
 * `on[a-z]+=` finds the `one=` in `standalone=`. Neither is a real fault, and
 * neither needed the safety rules relaxed to fix: the prolog is simply not
 * part of what they are meant to read.
 *
 * `<!DOCTYPE` and `<!ENTITY` are matched separately and stay refused.
 */
const XML_PROLOG = /^\s*<\?xml\b[^>]*\?>\s*/iu;

/**
 * Rejects anything that could execute, phone home or drag in an external
 * resource, then normalizes whitespace so the same drawing always produces
 * the same bytes.
 */
export function sanitizeSvg(svg: string): string {
  const body = svg.replace(XML_PROLOG, "");
  if (!body.trimStart().startsWith("<svg") || FORBIDDEN_SVG.test(body)) {
    throw new UnsafeAssetError("Unsafe SVG content");
  }
  return `${body
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/>\s+</gu, "><")
    .trim()}\n`;
}

/**
 * The width/height ratio the drawing declares, or null when it declares no
 * viewBox. A caller compares it with the ratio the metadata claims.
 */
export function svgViewBoxRatio(svg: string): number | null {
  // The root element's own box, not the first one in the file. A `<marker>`
  // or a `<symbol>` carries a viewBox of its own, and reading whichever came
  // first reported an arrowhead's 10x10 as the shape of the drawing: the
  // Nebraska state flag, 750x450, measured square because of the two markers
  // it defines.
  const root = /<svg\b[^>]*>/iu.exec(svg);
  if (root === null) {
    return null;
  }
  const viewBox =
    /\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/u.exec(
      root[0],
    );
  if (viewBox === null) {
    return null;
  }
  const ratio = Number(viewBox[1]) / Number(viewBox[2]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

/**
 * CSS absolute lengths, in the px the SVG user unit is defined against. A
 * ratio cancels the unit only when both sides carry the same one, which is
 * not guaranteed — `width="10cm" height="200"` is legal — so both are
 * converted rather than compared raw.
 */
const ABSOLUTE_UNITS: Readonly<Record<string, number>> = {
  "": 1,
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
};

function lengthInPx(raw: string | undefined): number | null {
  if (raw === undefined) {
    return null;
  }
  const parsed = /^\s*([\d.]+)\s*([a-z]*)\s*$/iu.exec(raw);
  if (parsed === null) {
    return null;
  }
  // A percentage is a share of a viewport this drawing has not been given,
  // so it says nothing about the drawing's own proportions.
  const factor = ABSOLUTE_UNITS[(parsed[2] ?? "").toLowerCase()];
  const value = Number(parsed[1]);
  if (factor === undefined || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value * factor;
}

/**
 * The ratio the root element's own `width` and `height` declare.
 *
 * The second way an SVG says how it is shaped, and on Wikimedia the common
 * one: of the forty-nine U.S. state flags published there, twenty-seven carry
 * no `viewBox` at all while all but three carry both attributes. Reading only
 * the viewBox refused more than half of them for proportions they had
 * declared plainly, one attribute over.
 */
export function svgIntrinsicRatio(svg: string): number | null {
  const root = /<svg\b[^>]*>/iu.exec(svg);
  if (root === null) {
    return null;
  }
  const width = lengthInPx(
    /\bwidth\s*=\s*["']([^"']*)["']/iu.exec(root[0])?.[1],
  );
  const height = lengthInPx(
    /\bheight\s*=\s*["']([^"']*)["']/iu.exec(root[0])?.[1],
  );
  if (width === null || height === null) {
    return null;
  }
  const ratio = width / height;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

/**
 * How wide the drawing is against its height, however it says so.
 *
 * The viewBox wins when there is one: it is the box aspect-fit actually fits
 * to, and a drawing carrying both can disagree with itself.
 */
export function svgAspectRatio(svg: string): number | null {
  return svgViewBoxRatio(svg) ?? svgIntrinsicRatio(svg);
}

export function assertAspectRatioMatchesViewBox(
  svg: string,
  aspectRatio: number,
  subject: string,
): void {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new UnsafeAssetError(`${subject} has an invalid aspect ratio`);
  }
  const declared = svgAspectRatio(svg);
  if (declared !== null && Math.abs(declared - aspectRatio) > 0.000_01) {
    throw new UnsafeAssetError(
      `${subject} aspect ratio does not match its viewBox`,
    );
  }
}

/**
 * Rasterizes sanitized SVG. Rendering is software-only and font-free — the
 * approved flags carry no text element — so identical input yields identical
 * bytes on every platform, which is what the deterministic-fixture check in
 * CI relies on.
 */
export function renderRaster(
  svg: string,
  scale: number,
): { png: Buffer; widthPx: number; heightPx: number } {
  const rendered = new Resvg(svg, {
    fitTo: { mode: "height", value: RASTER_BASE_HEIGHT_PT * scale },
  }).render();
  return {
    png: rendered.asPng(),
    widthPx: rendered.width,
    heightPx: rendered.height,
  };
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface ImageInspection {
  mimeType: "image/svg+xml" | "image/png";
  widthPx: number | null;
  heightPx: number | null;
  aspectRatio: number | null;
  /** Sanitized SVG text; absent for raster input, which is published as-is. */
  svg?: string;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Reads a PNG's declared size from its IHDR chunk, which the signature
 * guarantees comes first. A file whose bytes do not say PNG is not treated
 * as one no matter what the upload claimed: extension and client-supplied
 * media type are attacker-controlled, the bytes are not.
 */
export function inspectPng(bytes: Buffer): ImageInspection {
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new UnsafeAssetError("The file is not a PNG image");
  }
  const widthPx = bytes.readUInt32BE(16);
  const heightPx = bytes.readUInt32BE(20);
  if (widthPx === 0 || heightPx === 0) {
    throw new UnsafeAssetError("The PNG declares an empty canvas");
  }
  return {
    mimeType: "image/png",
    widthPx,
    heightPx,
    aspectRatio: widthPx / heightPx,
  };
}

/**
 * The single entry point an upload path should use: decide what the bytes
 * actually are, refuse anything else, and return only vetted output.
 */
export function inspectImage(bytes: Buffer): ImageInspection {
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return inspectPng(bytes);
  }
  const text = bytes.toString("utf8");
  const svg = sanitizeSvg(text);
  return {
    mimeType: "image/svg+xml",
    widthPx: null,
    heightPx: null,
    // Both ways a drawing can declare its shape. `widthPx`/`heightPx` stay
    // null on purpose: they are raster pixel counts, and a minimum-height
    // rule keyed off them has never applied to vector uploads. Filling them
    // here would start refusing drawings for a reason nobody changed.
    aspectRatio: svgAspectRatio(svg),
    svg,
  };
}
