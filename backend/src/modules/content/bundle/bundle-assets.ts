import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ObjectStorage } from "../../../infrastructure/object-storage/object-storage";
import type { BundleDomain } from "./bundle-domain";
import { sha256Hex, type LoadedBundle } from "./bundle-reader";

/**
 * Where a release serves one of its asset files from.
 *
 * The key is the URL: what a client is given is this key behind the bucket's
 * public address, so the address a release records and the place its files
 * actually are cannot drift apart. In production that address is the CDN in
 * front of the bucket, which is what keeps a published URL the one it has
 * always been.
 *
 * The bundle's own JSON documents keep their separate `content-bundles/`
 * prefix. They are the archive a rollback reads, not a public tree, and
 * nothing is served from them.
 */
export function assetObjectKey(contentVersion: string, path: string): string {
  return `content/${contentVersion}/${path}`;
}

/** The address every asset URL of this release is built on. */
export function assetBaseUrl(
  objectStorage: ObjectStorage,
  contentVersion: string,
): string {
  return objectStorage.publicUrl(assetObjectKey(contentVersion, ""));
}

interface AssetFile {
  path: string;
  sha256: string;
  mimeType: string;
}

/**
 * Every distinct file the release's assets refer to.
 *
 * An asset leads with the representation its own url describes, so the same
 * path is named twice; it is uploaded once.
 */
function assetFiles(domain: BundleDomain): AssetFile[] {
  const byPath = new Map<string, AssetFile>();
  for (const asset of domain.assets) {
    for (const representation of asset.representations) {
      byPath.set(representation.path, {
        path: representation.path,
        sha256: representation.sha256,
        mimeType: representation.mimeType,
      });
    }
  }
  return [...byPath.values()];
}

/**
 * Puts the flags a release publishes where the release says they are.
 *
 * Until this existed, a publish uploaded the fourteen JSON documents and none
 * of the seven hundred and fifty files they describe, so every environment but
 * the one the CDN already served answered a client with URLs to nothing.
 *
 * A file already stored under its checksum is left alone, which is what makes
 * republishing an unchanged release upload nothing at all.
 */
export async function uploadBundleAssets(
  bundle: LoadedBundle,
  domain: BundleDomain,
  objectStorage: ObjectStorage,
): Promise<{ uploaded: number; unchanged: number }> {
  let uploaded = 0;
  let unchanged = 0;

  for (const file of assetFiles(domain)) {
    const key = assetObjectKey(bundle.manifest.contentVersion, file.path);
    if (await objectStorage.objectExists(key, file.sha256)) {
      unchanged += 1;
      continue;
    }

    const content = await readFile(join(bundle.directory, file.path));
    // The manifest checksums the JSON documents and says nothing about these,
    // so this is the only place the bytes are checked against what the registry
    // claims they are. Publishing them unchecked would serve a flag the release
    // never described.
    const actual = sha256Hex(content);
    if (actual !== file.sha256) {
      throw new Error(
        `asset file ${file.path} does not match the checksum the registry records (expected ${file.sha256}, read ${actual})`,
      );
    }
    await objectStorage.putObject(key, content, file.mimeType);
    uploaded += 1;
  }

  return { uploaded, unchanged };
}
