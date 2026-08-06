import { InMemoryObjectStorage } from "./in-memory-object-storage";
import { loadObjectStorageConfig } from "./object-storage.config";
import { S3ObjectStorage } from "./s3-object-storage";
import type { ObjectStorage } from "./object-storage";

export function createObjectStorage(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStorage {
  const config = loadObjectStorageConfig(env);
  if (config.provider === "memory") {
    return new InMemoryObjectStorage(config.publicBaseUrl);
  }
  return new S3ObjectStorage(config);
}
