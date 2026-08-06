export interface ManifestFileEntry {
  path: string;
  bytes: number;
  sha256: string;
  schemaId: string;
}

export interface ManifestSignature {
  algorithm: "Ed25519";
  keyId: string;
  value: string;
}

export interface ContentManifest {
  schemaVersion: number;
  contentVersion: string;
  createdAt: string;
  defaultLocale: string;
  supportedLocales: string[];
  minimumClientVersion: string;
  supportedTemplateSchemaVersions: number[];
  assetBaseUrl: string;
  changeCursor: string;
  files: ManifestFileEntry[];
  signature: ManifestSignature;
  [key: string]: unknown;
}
