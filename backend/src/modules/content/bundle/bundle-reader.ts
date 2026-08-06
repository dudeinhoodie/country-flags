import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ContentManifest } from "./bundle-types";

export interface LoadedBundle {
  directory: string;
  manifest: ContentManifest;
  filesByPath: Map<string, Buffer>;
}

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function readManifest(
  bundleDir: string,
): Promise<ContentManifest> {
  const raw = await readFile(join(bundleDir, "manifest.json"), "utf8");
  return JSON.parse(raw) as ContentManifest;
}

export async function writeManifest(
  bundleDir: string,
  manifest: ContentManifest,
): Promise<void> {
  await writeFile(
    join(bundleDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

export async function loadBundle(bundleDir: string): Promise<LoadedBundle> {
  const manifest = await readManifest(bundleDir);
  const filesByPath = new Map<string, Buffer>();
  for (const file of manifest.files) {
    filesByPath.set(file.path, await readFile(join(bundleDir, file.path)));
  }
  return { directory: bundleDir, manifest, filesByPath };
}

export function parseJsonFile<T>(bundle: LoadedBundle, path: string): T {
  const content = bundle.filesByPath.get(path);
  if (content === undefined) {
    throw new Error(`Bundle is missing ${path}`);
  }
  return JSON.parse(content.toString("utf8")) as T;
}
