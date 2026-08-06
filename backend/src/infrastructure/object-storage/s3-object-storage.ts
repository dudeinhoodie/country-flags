import { createHash } from "node:crypto";

import {
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { ObjectStorageConfig } from "./object-storage.config";
import type { ObjectStorage } from "./object-storage";

const SHA256_METADATA_KEY = "sha256";

/** S3-compatible adapter. Serves local MinIO and any production S3-compatible target through config alone. */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: ObjectStorageConfig) {
    this.client = new S3Client({
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      ...(config.endpoint !== undefined ? { endpoint: config.endpoint } : {}),
      ...(config.accessKeyId !== undefined &&
      config.secretAccessKey !== undefined
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: {
          [SHA256_METADATA_KEY]: createHash("sha256")
            .update(body)
            .digest("hex"),
        },
      }),
    );
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      if (response.Body === undefined) {
        return null;
      }
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (error instanceof NoSuchKey || error instanceof NotFound) {
        return null;
      }
      throw error;
    }
  }

  async objectExists(key: string, sha256: string): Promise<boolean> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return head.Metadata?.[SHA256_METADATA_KEY] === sha256;
    } catch (error) {
      if (error instanceof NotFound) {
        return false;
      }
      throw error;
    }
  }

  publicUrl(key: string): string {
    return `${this.config.publicBaseUrl}/${key}`;
  }
}
