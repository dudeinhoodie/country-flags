import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { signManifest } from "../bundle-signer";
import type { ContentManifest } from "../bundle-types";

export function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export interface FixtureEntity {
  key: string;
  slug: string;
  en: string;
  ru: string;
}

export function entityRecord(entity: FixtureEntity): Record<string, unknown> {
  return {
    key: entity.key,
    type: "country",
    status: "active",
    includeInCountryCatalog: true,
    recognition: { status: "un_member" },
    names: {
      en: { short: entity.en },
      ru: { short: entity.ru },
    },
  };
}

export function assetRecord(entity: FixtureEntity): Record<string, unknown> {
  const svgContent = `<svg>${entity.slug}</svg>`;
  return {
    key: `flag.${entity.slug}.current`,
    entityKey: entity.key,
    path: `assets/svg/${entity.slug}.svg`,
    sha256: sha256(svgContent),
    mimeType: "image/svg+xml",
    representations: [
      {
        path: `assets/svg/${entity.slug}.svg`,
        mimeType: "image/svg+xml",
        sha256: sha256(svgContent),
      },
      ...[2, 3].map((scale) => ({
        path: `assets/png/${entity.slug}@${String(scale)}x.png`,
        mimeType: "image/png",
        sha256: sha256(`${svgContent}@${String(scale)}x`),
        scale,
        widthPx: 180 * scale,
        heightPx: 120 * scale,
      })),
    ],
    aspectRatio: 1.5,
    sourcePath: `flags/4x3/${entity.slug}.svg`,
    license: "MIT",
    attribution: "test fixture",
    provenance: {
      sourceKey: "flag-icons",
      revision: "v1",
      retrievedAt: "2026-08-06T00:00:00.000Z",
    },
    validFrom: null,
    validTo: null,
  };
}

export function learningCardRecord(
  entity: FixtureEntity,
): Record<string, unknown> {
  return {
    entityKey: entity.key,
    templateCode: "FLAG_TO_COUNTRY",
    templateSchemaVersion: 1,
    semanticVersion: 1,
    supersedesSemanticVersion: null,
    status: "active",
    revisions: [
      {
        revision: 1,
        promptAssetKey: `flag.${entity.slug}.current`,
        promptFingerprint: sha256(`${entity.key}:1`),
        changeClassification: "technical",
        progressPolicy: "preserve",
        effectiveFrom: "2026-08-06T00:00:00.000Z",
        retiredAt: null,
      },
    ],
  };
}

export interface BundleBuildOptions {
  contentVersion: string;
  entities: FixtureEntity[];
  deckMemberKeys?: string[];
  tamperFileAfterSigning?: { path: string; content: string };
  breakSignature?: boolean;
}

interface SigningKeys {
  keyId: string;
  privateKeyPem: string;
}

export function buildBundle(
  dir: string,
  keys: SigningKeys,
  options: BundleBuildOptions,
): void {
  mkdirSync(join(dir, "assets", "svg"), { recursive: true });
  mkdirSync(join(dir, "assets", "png"), { recursive: true });
  for (const entity of options.entities) {
    const svg = `<svg>${entity.slug}</svg>`;
    writeFileSync(join(dir, "assets", "svg", `${entity.slug}.svg`), svg);
    // The registry declares a raster for every scale, so the bundle has to
    // carry one: a publish uploads the files its assets name, and a fixture
    // that named files it did not ship would only prove that nothing looked.
    for (const scale of [2, 3]) {
      writeFileSync(
        join(dir, "assets", "png", `${entity.slug}@${String(scale)}x.png`),
        `${svg}@${String(scale)}x`,
      );
    }
  }

  const catalog = {
    schemaVersion: 1,
    catalogVersion: options.contentVersion,
    defaultLocale: "en",
    supportedLocales: ["en", "ru"],
    entities: options.entities.map(entityRecord),
    relations: [],
    decks: [
      {
        key: "deck.all",
        kind: "curated",
        names: { en: { name: "All" }, ru: { name: "Все" } },
        memberEntityKeys:
          options.deckMemberKeys ??
          options.entities.map((entity) => entity.key),
      },
    ],
  };

  const assets = {
    schemaVersion: 1,
    assets: options.entities.map(assetRecord),
  };

  const cardTemplates = {
    schemaVersion: 1,
    templates: [
      {
        code: "FLAG_TO_COUNTRY",
        schemaVersion: 1,
        promptType: "FLAG_ASSET",
        answerType: "GEO_ENTITY_NAME",
        gradingMode: "self_rated",
        promptSpec: { assetType: "FLAG" },
        answerSpec: { nameType: "SHORT" },
        status: "published",
      },
    ],
  };

  const learningCards = {
    schemaVersion: 1,
    cards: options.entities.map(learningCardRecord),
  };

  const files = [
    {
      path: "catalog.json",
      content: catalog,
      schemaId: "https://country-flags.example/schemas/catalog.schema.json",
    },
    {
      path: "assets/assets.json",
      content: assets,
      schemaId:
        "https://country-flags.app/content/v1/asset-registry.schema.json",
    },
    {
      path: "card-templates.json",
      content: cardTemplates,
      schemaId:
        "https://country-flags.app/content/v1/card-templates.schema.json",
    },
    {
      path: "learning-cards.json",
      content: learningCards,
      schemaId:
        "https://country-flags.app/content/v1/learning-cards.schema.json",
    },
  ];

  const manifestFiles = files.map((file) => {
    const serialized = JSON.stringify(file.content);
    writeFileSync(join(dir, file.path), serialized);
    return {
      path: file.path,
      bytes: Buffer.byteLength(serialized),
      sha256: sha256(serialized),
      schemaId: file.schemaId,
    };
  });

  const manifest: ContentManifest = {
    schemaVersion: 1,
    contentVersion: options.contentVersion,
    createdAt: "2026-08-06T00:00:00.000Z",
    defaultLocale: "en",
    supportedLocales: ["en", "ru"],
    minimumClientVersion: "1.0.0",
    supportedTemplateSchemaVersions: [1],
    assetBaseUrl: `https://cdn.test/content/${options.contentVersion}/`,
    changeCursor: `content:${options.contentVersion}:0`,
    files: manifestFiles,
    signature: { algorithm: "Ed25519", keyId: keys.keyId, value: "" },
  };
  manifest.signature = signManifest(manifest, keys.privateKeyPem, keys.keyId);

  if (options.tamperFileAfterSigning !== undefined) {
    writeFileSync(
      join(dir, options.tamperFileAfterSigning.path),
      options.tamperFileAfterSigning.content,
    );
  }
  if (options.breakSignature === true) {
    manifest.signature = {
      ...manifest.signature,
      value: Buffer.from("not-a-real-signature").toString("base64"),
    };
  }

  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
}
