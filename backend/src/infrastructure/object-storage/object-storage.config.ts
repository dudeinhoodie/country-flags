export type ObjectStorageProvider = "s3" | "memory";

export interface ObjectStorageConfig {
  provider: ObjectStorageProvider;
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
  publicBaseUrl: string;
}

function requiredString(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Environment variable ${key} is required`);
  }
  return value.trim();
}

function optionalString(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string,
): string {
  const value = env[key];
  return value === undefined || value.trim().length === 0
    ? fallback
    : value.trim();
}

export function loadObjectStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStorageConfig {
  const provider = optionalString(env, "OBJECT_STORAGE_PROVIDER", "memory");
  if (provider !== "s3" && provider !== "memory") {
    throw new Error(
      "Environment variable OBJECT_STORAGE_PROVIDER must be 's3' or 'memory'",
    );
  }

  if (provider === "memory") {
    return {
      provider,
      bucket: optionalString(env, "OBJECT_STORAGE_BUCKET", "content"),
      region: optionalString(env, "OBJECT_STORAGE_REGION", "local"),
      forcePathStyle: true,
      publicBaseUrl: optionalString(
        env,
        "OBJECT_STORAGE_PUBLIC_BASE_URL",
        "https://objects.test",
      ),
    };
  }

  const endpoint = env.OBJECT_STORAGE_ENDPOINT?.trim();

  return {
    provider,
    bucket: requiredString(env, "OBJECT_STORAGE_BUCKET"),
    region: optionalString(env, "OBJECT_STORAGE_REGION", "us-east-1"),
    ...(endpoint !== undefined && endpoint.length > 0 ? { endpoint } : {}),
    accessKeyId: requiredString(env, "OBJECT_STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: requiredString(env, "OBJECT_STORAGE_SECRET_ACCESS_KEY"),
    forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE === "true",
    publicBaseUrl: requiredString(
      env,
      "OBJECT_STORAGE_PUBLIC_BASE_URL",
    ).replace(/\/+$/, ""),
  };
}
