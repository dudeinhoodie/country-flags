import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { sha256 } from "./stable-json.js";
import type { AssetCandidate, Provenance } from "./types.js";

export interface BuiltAsset {
  key: string;
  entityKey: string;
  path: string;
  mimeType: "image/svg+xml";
  sha256: string;
  aspectRatio: number;
  sourcePath: string;
  license: string;
  attribution: string;
  provenance: Provenance;
  validFrom: string | null;
  validTo: string | null;
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
  return {
    key: `flag.${slug}.current`,
    entityKey,
    path: relativePath,
    mimeType: "image/svg+xml",
    sha256: sha256(svg),
    aspectRatio: candidate.aspectRatio,
    sourcePath: candidate.upstreamPath,
    license: candidate.license,
    attribution: "lipis/flag-icons contributors",
    provenance: candidate.provenance,
    validFrom: candidate.validFrom ?? null,
    validTo: candidate.validTo ?? null,
  };
}
