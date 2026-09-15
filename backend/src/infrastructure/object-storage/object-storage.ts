export interface PutObjectOptions {
  /**
   * The `Cache-Control` the object is served with. Content files are
   * immutable and carry none; a site snapshot is rewritten in place and
   * has to say how long a reader may keep the old copy.
   */
  cacheControl?: string;
}

export interface ObjectStorage {
  putObject(
    key: string,
    body: Buffer,
    contentType: string,
    options?: PutObjectOptions,
  ): Promise<void>;
  getObject(key: string): Promise<Buffer | null>;
  /** Removes the object; a key that does not exist is not an error. */
  deleteObject(key: string): Promise<void>;
  objectExists(key: string, sha256: string): Promise<boolean>;
  publicUrl(key: string): string;
}
