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
 * Rejects anything that could execute, phone home or drag in an external
 * resource, then normalizes whitespace so the same drawing always produces
 * the same bytes.
 */
export function sanitizeSvg(svg: string): string {
  if (!svg.trimStart().startsWith("<svg") || FORBIDDEN_SVG.test(svg)) {
    throw new UnsafeAssetError("Unsafe SVG content");
  }
  return `${svg
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/>\s+</gu, "><")
    .trim()}\n`;
}

/**
 * The width/height ratio the drawing declares, or null when it declares no
 * viewBox. A caller compares it with the ratio the metadata claims.
 */
export function svgViewBoxRatio(svg: string): number | null {
  const viewBox =
    /\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/u.exec(
      svg,
    );
  if (viewBox === null) {
    return null;
  }
  const ratio = Number(viewBox[1]) / Number(viewBox[2]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

export function assertAspectRatioMatchesViewBox(
  svg: string,
  aspectRatio: number,
  subject: string,
): void {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new UnsafeAssetError(`${subject} has an invalid aspect ratio`);
  }
  const declared = svgViewBoxRatio(svg);
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
