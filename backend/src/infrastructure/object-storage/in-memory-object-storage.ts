import { createHash } from "node:crypto";

import type { ObjectStorage, PutObjectOptions } from "./object-storage";

interface StoredObject {
  body: Buffer;
  contentType: string;
  cacheControl: string | undefined;
  sha256: string;
}

/** Test/local adapter with no network dependency. */
export class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, StoredObject>();

  constructor(private readonly baseUrl = "https://objects.test") {}

  putObject(
    key: string,
    body: Buffer,
    contentType: string,
    options: PutObjectOptions = {},
  ): Promise<void> {
    this.objects.set(key, {
      body: Buffer.from(body),
      contentType,
      cacheControl: options.cacheControl,
      sha256: createHash("sha256").update(body).digest("hex"),
    });
    return Promise.resolve();
  }

  getObject(key: string): Promise<Buffer | null> {
    const stored = this.objects.get(key);
    return Promise.resolve(
      stored === undefined ? null : Buffer.from(stored.body),
    );
  }

  deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  objectExists(key: string, sha256: string): Promise<boolean> {
    return Promise.resolve(this.objects.get(key)?.sha256 === sha256);
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }

  /** What a test can read back: the headers an object was stored with. */
  describe(
    key: string,
  ): { contentType: string; cacheControl: string | undefined } | null {
    const stored = this.objects.get(key);
    return stored === undefined
      ? null
      : { contentType: stored.contentType, cacheControl: stored.cacheControl };
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }
}
