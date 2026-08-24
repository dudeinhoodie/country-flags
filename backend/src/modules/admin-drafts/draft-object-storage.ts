import { Inject, Injectable } from "@nestjs/common";

import { createObjectStorage } from "../../infrastructure/object-storage/create-object-storage";
import type { ObjectStorage } from "../../infrastructure/object-storage/object-storage";

export const DRAFT_OBJECT_STORAGE = Symbol("DRAFT_OBJECT_STORAGE");

/**
 * Draft uploads live in their own bucket, never in a prefix of the public
 * one: published content is served from a bucket with uniform public read,
 * where a "private prefix" is not private at all. The console shows drafts
 * through the backend instead of linking at storage, so nothing depends on
 * this bucket being reachable from a browser.
 *
 * Configured by ADMIN_DRAFT_OBJECT_STORAGE_* variables, falling back to the
 * in-memory store so local runs and tests need no bucket.
 */
export function createDraftObjectStorage(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStorage {
  const prefixed: NodeJS.ProcessEnv = { ...env };
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("ADMIN_DRAFT_OBJECT_STORAGE_")) {
      prefixed[key.replace("ADMIN_DRAFT_", "")] = value;
    }
  }
  if (prefixed.ADMIN_DRAFT_OBJECT_STORAGE_PROVIDER === undefined) {
    prefixed.OBJECT_STORAGE_PROVIDER = "memory";
  }
  return createObjectStorage(prefixed);
}

@Injectable()
export class DraftObjectStore {
  constructor(
    @Inject(DRAFT_OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * The key is derived from the content checksum, never from anything the
   * client sent: a filename is attacker-controlled and a path is a way out
   * of the prefix it was supposed to stay in.
   */
  objectKey(draftId: string, sha256: string, extension: string): string {
    return `drafts/${draftId}/${sha256}.${extension}`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.storage.putObject(key, body, contentType);
  }

  get(key: string): Promise<Buffer | null> {
    return this.storage.getObject(key);
  }
}
