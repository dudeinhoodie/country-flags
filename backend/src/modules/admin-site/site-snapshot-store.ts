import { Inject, Injectable } from "@nestjs/common";

import { createObjectStorage } from "../../infrastructure/object-storage/create-object-storage";
import { loadObjectStorageConfig } from "../../infrastructure/object-storage/object-storage.config";
import type { ObjectStorage } from "../../infrastructure/object-storage/object-storage";
import {
  serializeSnapshot,
  SNAPSHOT_CACHE_CONTROL,
  SNAPSHOT_INDEX_KEY,
  snapshotDocumentKey,
} from "./site-snapshot";
import type { SnapshotDocument, SnapshotIndex } from "./site-snapshot";

export const SITE_OBJECT_STORAGE = Symbol("SITE_OBJECT_STORAGE");

const ENV_PREFIX = "SITE_OBJECT_STORAGE_";

/**
 * The site bucket's variables, mapped onto the shared adapter's names the
 * way the draft bucket's are: `SITE_OBJECT_STORAGE_*` becomes
 * `OBJECT_STORAGE_*`, and an unset provider means the in-process store, so
 * local runs and tests publish somewhere that vanishes with the process.
 */
export function siteObjectStorageEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const prefixed: NodeJS.ProcessEnv = { ...env };
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(ENV_PREFIX)) {
      prefixed[key.replace("SITE_", "")] = value;
    }
  }
  if (prefixed.SITE_OBJECT_STORAGE_PROVIDER === undefined) {
    prefixed.OBJECT_STORAGE_PROVIDER = "memory";
  }
  return prefixed;
}

export function createSiteObjectStorage(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStorage {
  return createObjectStorage(siteObjectStorageEnvironment(env));
}

/** Whether publishing reaches a bucket a site can read, and where. */
export function describeSiteObjectStorage(
  env: NodeJS.ProcessEnv = process.env,
): { configured: boolean; publicBaseUrl: string | null } {
  const config = loadObjectStorageConfig(siteObjectStorageEnvironment(env));
  return config.provider === "memory"
    ? { configured: false, publicBaseUrl: null }
    : { configured: true, publicBaseUrl: config.publicBaseUrl };
}

/**
 * The snapshot as the site reads it: one index and one file per published
 * document, all under `documents/`, all served with a short cache so a
 * publish is visible within a minute (ADR-023).
 */
@Injectable()
export class SiteSnapshotStore {
  constructor(
    @Inject(SITE_OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async writeDocument(document: SnapshotDocument): Promise<void> {
    await this.storage.putObject(
      snapshotDocumentKey(document.slug, document.locale),
      serializeSnapshot(document),
      "application/json",
      { cacheControl: SNAPSHOT_CACHE_CONTROL },
    );
  }

  async removeDocument(slug: string, locale: string): Promise<void> {
    await this.storage.deleteObject(snapshotDocumentKey(slug, locale));
  }

  async writeIndex(index: SnapshotIndex): Promise<void> {
    await this.storage.putObject(
      SNAPSHOT_INDEX_KEY,
      serializeSnapshot(index),
      "application/json",
      { cacheControl: SNAPSHOT_CACHE_CONTROL },
    );
  }

  /** Where the index is readable, for the console to show. */
  indexUrl(): string {
    return this.storage.publicUrl(SNAPSHOT_INDEX_KEY);
  }
}
