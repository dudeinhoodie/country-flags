import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

import { stableJson } from "./stable-json";
import type { ContentManifest, ManifestSignature } from "./bundle-types";

function canonicalPayload(manifest: ContentManifest): Buffer {
  const rest: Record<string, unknown> = { ...manifest };
  delete rest.signature;
  delete rest.$schema;
  return Buffer.from(stableJson(rest), "utf8");
}

export function signManifest(
  manifest: ContentManifest,
  privateKeyPem: string,
  keyId: string,
): ManifestSignature {
  const privateKey = createPrivateKey(privateKeyPem);
  const value = sign(null, canonicalPayload(manifest), privateKey).toString(
    "base64",
  );
  return { algorithm: "Ed25519", keyId, value };
}

export function verifyManifestSignature(
  manifest: ContentManifest,
  publicKeysByKeyId: Record<string, string>,
): boolean {
  const publicKeyPem = publicKeysByKeyId[manifest.signature.keyId];
  if (publicKeyPem === undefined) {
    return false;
  }
  if (manifest.signature.algorithm !== "Ed25519") {
    return false;
  }

  try {
    const publicKey = createPublicKey(publicKeyPem);
    return verify(
      null,
      canonicalPayload(manifest),
      publicKey,
      Buffer.from(manifest.signature.value, "base64"),
    );
  } catch {
    return false;
  }
}

export function loadSigningPrivateKey(env: NodeJS.ProcessEnv = process.env): {
  keyId: string;
  privateKeyPem: string;
} {
  const keyId = env.CONTENT_SIGNING_KEY_ID?.trim();
  const encoded = env.CONTENT_SIGNING_PRIVATE_KEY?.trim();
  if (keyId === undefined || keyId.length === 0) {
    throw new Error("Environment variable CONTENT_SIGNING_KEY_ID is required");
  }
  if (encoded === undefined || encoded.length === 0) {
    throw new Error(
      "Environment variable CONTENT_SIGNING_PRIVATE_KEY is required",
    );
  }
  return {
    keyId,
    privateKeyPem: Buffer.from(encoded, "base64").toString("utf8"),
  };
}

export function loadSigningPublicKeys(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const encoded = env.CONTENT_SIGNING_PUBLIC_KEYS?.trim();
  if (encoded === undefined || encoded.length === 0) {
    throw new Error(
      "Environment variable CONTENT_SIGNING_PUBLIC_KEYS is required",
    );
  }
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Record<
    string,
    string
  >;
}
