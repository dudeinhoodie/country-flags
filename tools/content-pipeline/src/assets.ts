import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Resvg } from "@resvg/resvg-js";

import { sha256 } from "./stable-json.js";
import type { AssetCandidate, Provenance } from "./types.js";

/// The study prompt draws a flag about this tall, which is the largest place one
/// appears; the country rows and quiz options scale the same file down.
const RASTER_BASE_HEIGHT_PT = 120;

/// Raster is published at the screen scales the supported devices actually use.
/// There is no `@1x` because no device the app runs on has one.
const RASTER_SCALES = [2, 3] as const;

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
  path: string;
  mimeType: "image/svg+xml";
  sha256: string;
  /// Ordered by client preference: the vector original, then raster by
  /// ascending scale.
  representations: AssetRepresentation[];
  aspectRatio: number;
  sourcePath: string;
  license: string;
  attribution: string;
  provenance: Provenance;
  validFrom: string | null;
  validTo: string | null;
}

/// Rasterizes sanitized SVG into the published PNG set.
///
/// Rendering is software-only and font-free — the approved flags contain no
/// text element — so the same input produces the same bytes on every platform
/// that builds the bundle. The deterministic-fixture check in CI depends on
/// that property holding.
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

export function sanitizeSvg(svg: string): string {
  const forbidden =
    /<!DOCTYPE|<!ENTITY|<(?:script|style|foreignObject|iframe|object|embed)\b|on[a-z]+\s*=|(?:href|src)\s*=\s*["'](?:https?:|data:|javascript:)|url\s*\(\s*["']?(?:https?:|data:|javascript:)/iu;
  if (!svg.trimStart().startsWith("<svg") || forbidden.test(svg)) {
    throw new Error("Unsafe SVG content");
  }
  return `${svg
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/>\s+</gu, "><")
    .trim()}\n`;
}

export async function buildAsset(
  outputDirectory: string,
  entityKey: string,
  candidate: AssetCandidate,
): Promise<BuiltAsset> {
  if (!Number.isFinite(candidate.aspectRatio) || candidate.aspectRatio <= 0) {
    throw new Error(`${entityKey} asset has invalid aspect ratio`);
  }
  if (candidate.license.trim().length === 0) {
    throw new Error(`${entityKey} asset has no approved license`);
  }
  const svg = sanitizeSvg(candidate.svg);
  const viewBox =
    /\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/u.exec(
      svg,
    );
  if (viewBox !== null) {
    const width = Number(viewBox[1]);
    const height = Number(viewBox[2]);
    const actualRatio = width / height;
    if (
      !Number.isFinite(actualRatio) ||
      Math.abs(actualRatio - candidate.aspectRatio) > 0.000_01
    ) {
      throw new Error(`${entityKey} asset aspect ratio does not match viewBox`);
    }
  }
  const slug = entityKey.replace(/^(?:area|country|territory)\./u, "");
  const relativePath = `assets/svg/${slug}.svg`;
  await mkdir(join(outputDirectory, "assets/svg"), { recursive: true });
  await writeFile(join(outputDirectory, relativePath), svg, "utf8");

  // Raster is rendered from the sanitized bytes that were just published, so
  // the PNG can never depict something the vector does not.
  await mkdir(join(outputDirectory, "assets/png"), { recursive: true });
  const raster: AssetRepresentation[] = [];
  for (const scale of RASTER_SCALES) {
    const { png, widthPx, heightPx } = renderRaster(svg, scale);
    const rasterPath = `assets/png/${slug}@${String(scale)}x.png`;
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
    key: `flag.${slug}.current`,
    entityKey,
    path: relativePath,
    mimeType: "image/svg+xml",
    sha256: sha256(svg),
    representations: [
      { path: relativePath, mimeType: "image/svg+xml", sha256: sha256(svg) },
      ...raster,
    ],
    aspectRatio: candidate.aspectRatio,
    sourcePath: candidate.upstreamPath,
    license: candidate.license,
    attribution: "lipis/flag-icons contributors",
    provenance: candidate.provenance,
    validFrom: candidate.validFrom ?? null,
    validTo: candidate.validTo ?? null,
  };
}
