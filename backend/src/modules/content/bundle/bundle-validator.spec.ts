import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { signManifest } from "./bundle-signer";
import { BundleValidationError, validateBundle } from "./bundle-validator";
import type { ContentManifest } from "./bundle-types";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PRIVATE_KEY_PEM = privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const PUBLIC_KEY_PEM = publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const KEY_ID = "test-key";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

interface BundleFile {
  path: string;
  content: unknown;
  schemaId: string;
}

function catalogFixture(
  overrides: {
    entities?: unknown[];
    decks?: unknown[];
  } = {},
): Record<string, unknown> {
  const entities = overrides.entities ?? [
    {
      key: "country.testland",
      type: "country",
      status: "active",
      includeInCountryCatalog: true,
      recognition: { status: "un_member" },
      names: {
        en: { short: "Testland" },
        ru: { short: "Тестландия" },
      },
    },
  ];
  return {
    schemaVersion: 1,
    catalogVersion: "test-v1",
    defaultLocale: "en",
    supportedLocales: ["en", "ru"],
    entities,
    relations: [],
    decks: overrides.decks ?? [
      {
        key: "deck.all",
        kind: "curated",
        names: { en: { name: "All" }, ru: { name: "Все" } },
        memberEntityKeys: ["country.testland"],
      },
    ],
  };
}

function representationsFixture(): Record<string, unknown>[] {
  return [
    {
      path: "assets/svg/testland.svg",
      mimeType: "image/svg+xml",
      sha256: sha256("<svg>flag</svg>"),
    },
    {
      path: "assets/png/testland@2x.png",
      mimeType: "image/png",
      sha256: sha256("<svg>flag</svg>@2x"),
      scale: 2,
      widthPx: 360,
      heightPx: 240,
    },
  ];
}

function assetsFixture(
  overrides: {
    license?: string;
    representations?: Record<string, unknown>[];
  } = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    assets: [
      {
        key: "flag.testland.current",
        entityKey: "country.testland",
        representations: overrides.representations ?? representationsFixture(),
        aspectRatio: 1.5,
        sourcePath: "flags/4x3/tl.svg",
        license: overrides.license ?? "MIT",
        attribution: "test fixture",
        provenance: {
          sourceKey: "flag-icons",
          revision: "v1",
          retrievedAt: "2026-08-06T00:00:00.000Z",
        },
        validFrom: null,
        validTo: null,
      },
    ],
  };
}

function cardTemplatesFixture(): Record<string, unknown> {
  return {
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
}

function learningCardsFixture(
  overrides: { cards?: unknown[] } = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    cards: overrides.cards ?? [
      {
        entityKey: "country.testland",
        templateCode: "FLAG_TO_COUNTRY",
        templateSchemaVersion: 1,
        semanticVersion: 1,
        supersedesSemanticVersion: null,
        status: "active",
        revisions: [
          {
            revision: 1,
            promptAssetKey: "flag.testland.current",
            promptFingerprint: sha256("testland:1"),
            changeClassification: "technical",
            progressPolicy: "preserve",
            effectiveFrom: "2026-08-06T00:00:00.000Z",
            retiredAt: null,
          },
        ],
      },
    ],
  };
}

interface BuildOptions {
  catalog?: Record<string, unknown>;
  assets?: Record<string, unknown>;
  learningCards?: Record<string, unknown>;
  tamperFileAfterSigning?: { path: string; content: string };
  breakSignature?: boolean;
}

function buildBundle(dir: string, options: BuildOptions = {}): void {
  const files: BundleFile[] = [
    {
      path: "catalog.json",
      content: options.catalog ?? catalogFixture(),
      schemaId: "https://country-flags.example/schemas/catalog.schema.json",
    },
    {
      path: "assets/assets.json",
      content: options.assets ?? assetsFixture(),
      schemaId:
        "https://country-flags.app/content/v1/asset-registry.schema.json",
    },
    {
      path: "card-templates.json",
      content: cardTemplatesFixture(),
      schemaId:
        "https://country-flags.app/content/v1/card-templates.schema.json",
    },
    {
      path: "learning-cards.json",
      content: options.learningCards ?? learningCardsFixture(),
      schemaId:
        "https://country-flags.app/content/v1/learning-cards.schema.json",
    },
  ];

  mkdirSync(join(dir, "assets", "svg"), { recursive: true });
  writeFileSync(join(dir, "assets", "svg", "testland.svg"), "<svg>flag</svg>");

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
    contentVersion: "test-v1",
    createdAt: "2026-08-06T00:00:00.000Z",
    defaultLocale: "en",
    supportedLocales: ["en", "ru"],
    minimumClientVersion: "1.0.0",
    supportedTemplateSchemaVersions: [1],
    assetBaseUrl: "https://cdn.test/content/test-v1/",
    changeCursor: "content:test-v1:0",
    files: manifestFiles,
    signature: { algorithm: "Ed25519", keyId: KEY_ID, value: "" },
  };
  manifest.signature = signManifest(manifest, PRIVATE_KEY_PEM, KEY_ID);

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

describe("validateBundle", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "content-bundle-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a well-formed, signed bundle", async () => {
    buildBundle(dir);
    const result = await validateBundle(dir, { [KEY_ID]: PUBLIC_KEY_PEM });
    expect(result.domain.catalog.entities).toHaveLength(1);
    expect(result.domain.learningCards).toHaveLength(1);
  });

  it("rejects a bundle whose file no longer matches its manifest checksum", async () => {
    buildBundle(dir, {
      tamperFileAfterSigning: {
        path: "catalog.json",
        content: JSON.stringify(catalogFixture()).replace(
          "Testland",
          "Tampered",
        ),
      },
    });
    await expect(
      validateBundle(dir, { [KEY_ID]: PUBLIC_KEY_PEM }),
    ).rejects.toThrow(/checksum or byte count/);
  });

  it("rejects a bundle with an invalid signature", async () => {
    buildBundle(dir, { breakSignature: true });
    await expect(
      validateBundle(dir, { [KEY_ID]: PUBLIC_KEY_PEM }),
    ).rejects.toThrow(BundleValidationError);
  });

  it("rejects a deck that references an unknown entity", async () => {
    buildBundle(dir, {
      catalog: catalogFixture({
        decks: [
          {
            key: "deck.all",
            kind: "curated",
            names: { en: { name: "All" }, ru: { name: "Все" } },
            memberEntityKeys: ["country.unknown"],
          },
        ],
      }),
    });
    await expect(
      validateBundle(dir, { [KEY_ID]: PUBLIC_KEY_PEM }),
    ).rejects.toThrow(/references unknown entity/);
  });

  it("rejects decks whose keys derive the same code", async () => {
    buildBundle(dir, {
      catalog: catalogFixture({
        decks: [
          {
            key: "deck.south-america",
            kind: "curated",
            names: {
              en: { name: "South America" },
              ru: { name: "Южная Америка" },
            },
            memberEntityKeys: ["country.testland"],
          },
          {
            key: "deck.south_america",
            kind: "curated",
            names: { en: { name: "The Americas" }, ru: { name: "Америки" } },
            memberEntityKeys: ["country.testland"],
          },
        ],
      }),
    });
    await expect(
      validateBundle(dir, { [KEY_ID]: PUBLIC_KEY_PEM }),
    ).rejects.toThrow(/both derive the code "SOUTH_AMERICA"/);
  });

  it("rejects a deck whose key derives a code the contract refuses", async () => {
    buildBundle(dir, {
      catalog: catalogFixture({
        decks: [
          {
            key: "deck.1990s",
            kind: "curated",
            names: { en: { name: "The nineties" }, ru: { name: "Девяностые" } },
            memberEntityKeys: ["country.testland"],
          },
        ],
      }),
    });
    await expect(
      validateBundle(dir, { [KEY_ID]: PUBLIC_KEY_PEM }),
    ).rejects.toThrow(
      /derives the code "1990S", which the contract does not allow/,
    );
  });

  it("rejects an entity missing a name in a supported locale", async () => {
    buildBundle(dir, {
      catalog: catalogFixture({
        entities: [
          {
            key: "country.testland",
            type: "country",
            status: "active",
            includeInCountryCatalog: true,
            recognition: { status: "un_member" },
            names: { en: { short: "Testland" } },
          },
        ],
      }),
    });
    await expect(
      validateBundle(dir, { [KEY_ID]: PUBLIC_KEY_PEM }),
    ).rejects.toThrow(/missing a ru name/);
  });

  it("rejects entities whose keys collide on the derived slug", async () => {
    buildBundle(dir, {
      catalog: catalogFixture({
        entities: [
          {
            key: "country.testland",
            type: "country",
            status: "active",
            includeInCountryCatalog: true,
            recognition: { status: "un_member" },
            names: {
              en: { short: "Testland" },
              ru: { short: "Тестландия" },
            },
          },
          {
            key: "region.testland",
            type: "region",
            status: "active",
            includeInCountryCatalog: false,
            recognition: { status: "not_applicable" },
            names: {
              en: { short: "Testland Region" },
              ru: { short: "Регион Тестландия" },
            },
          },
        ],
      }),
    });
    await expect(
      validateBundle(dir, { [KEY_ID]: PUBLIC_KEY_PEM }),
    ).rejects.toThrow(/map to slug/);
  });

  it("rejects an asset with an empty license", async () => {
    buildBundle(dir, { assets: assetsFixture({ license: "" }) });
    await expect(
      validateBundle(dir, { [KEY_ID]: PUBLIC_KEY_PEM }),
    ).rejects.toThrow(/license/i);
  });

  // The release that shipped issue #82 passed every check it had: the vector
  // downloaded and matched its checksum, and no client could draw it.
  it("rejects an asset that publishes only a vector", async () => {
    buildBundle(dir, {
      assets: assetsFixture({
        representations: [representationsFixture()[0]!],
      }),
    });
    await expect(
      validateBundle(dir, { [KEY_ID]: PUBLIC_KEY_PEM }),
    ).rejects.toThrow(/no raster representation/);
  });

  it("rejects an asset that does not lead with its vector original", async () => {
    const [vector, raster] = representationsFixture();
    buildBundle(dir, {
      assets: assetsFixture({ representations: [raster!, vector!] }),
    });
    await expect(
      validateBundle(dir, { [KEY_ID]: PUBLIC_KEY_PEM }),
    ).rejects.toThrow(/does not lead with its vector original/);
  });

  it("rejects raster representations that are not ordered by ascending scale", async () => {
    const [vector, raster] = representationsFixture();
    buildBundle(dir, {
      assets: assetsFixture({
        representations: [
          vector!,
          { ...raster!, path: "assets/png/testland@3x.png", scale: 3 },
          raster!,
        ],
      }),
    });
    await expect(
      validateBundle(dir, { [KEY_ID]: PUBLIC_KEY_PEM }),
    ).rejects.toThrow(/ascending scale/);
  });
});
