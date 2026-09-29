import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { EnvironmentVariables } from "../../config/environment.validation";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Encryption at rest for provider credentials the backend has to keep, today
 * the Sign in with Apple refresh token (docs/01 §5.1).
 *
 * AES-256-GCM under `AUTH_PROVIDER_TOKEN_ENCRYPTION_KEY`, with a fresh IV per
 * value and the owning row's context as associated data, so a ciphertext
 * copied onto another identity does not decrypt. The stored form is
 * `v1.<iv>.<ciphertext>.<tag>` in base64url; the version leaves room for a
 * key rotation without guessing what an old value was sealed with.
 *
 * An empty key means the deployment keeps no provider tokens at all, which is
 * a state rather than a failure: callers ask `configured` first.
 */
@Injectable()
export class ProviderTokenCipher {
  private readonly key: Buffer | null;

  constructor(config: ConfigService<EnvironmentVariables>) {
    const encoded = config.get<string>("AUTH_PROVIDER_TOKEN_ENCRYPTION_KEY");
    this.key =
      typeof encoded === "string" && encoded.length > 0
        ? Buffer.from(encoded, "base64")
        : null;
  }

  get configured(): boolean {
    return this.key !== null;
  }

  seal(plaintext: string, context: string): string {
    const key = this.requireKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(Buffer.from(context, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return [
      VERSION,
      iv.toString("base64url"),
      ciphertext.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".");
  }

  open(sealed: string, context: string): string {
    const key = this.requireKey();
    const [version, iv, ciphertext, tag, ...rest] = sealed.split(".");
    if (
      version !== VERSION ||
      iv === undefined ||
      ciphertext === undefined ||
      tag === undefined ||
      rest.length > 0
    ) {
      throw new Error("Sealed provider token has an unknown format");
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, "base64url"),
      { authTagLength: TAG_BYTES },
    );
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  private requireKey(): Buffer {
    if (this.key === null) {
      throw new Error("Provider token encryption is not configured");
    }
    return this.key;
  }
}
