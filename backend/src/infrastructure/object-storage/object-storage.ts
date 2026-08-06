export interface ObjectStorage {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<Buffer | null>;
  objectExists(key: string, sha256: string): Promise<boolean>;
  publicUrl(key: string): string;
}
