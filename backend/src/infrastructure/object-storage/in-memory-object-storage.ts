import { createHash } from "node:crypto";

import type { ObjectStorage } from "./object-storage";

interface StoredObject {
  body: Buffer;
  sha256: string;
}

/** Test/local adapter with no network dependency. */
export class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, StoredObject>();

  constructor(private readonly baseUrl = "https://objects.test") {}

  putObject(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, {
      body: Buffer.from(body),
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

  objectExists(key: string, sha256: string): Promise<boolean> {
    return Promise.resolve(this.objects.get(key)?.sha256 === sha256);
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }
}
