import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryObjectStorage } from "../../../infrastructure/object-storage/in-memory-object-storage";
import { assetBaseUrl, uploadBundleAssets } from "./bundle-assets";
import { parseBundleDomain, type BundleDomain } from "./bundle-domain";
import { loadBundle, type LoadedBundle } from "./bundle-reader";
import {
  buildBundle,
  type FixtureEntity,
} from "./test-support/bundle-fixture-builder";

const { privateKey } = generateKeyPairSync("ed25519");
const KEYS = {
  keyId: "test-key",
  privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};

const ENTITIES: FixtureEntity[] = [
  {
    key: "country.testland",
    slug: "testland",
    en: "Testland",
    ru: "Тестландия",
  },
  {
    key: "country.otherland",
    slug: "otherland",
    en: "Otherland",
    ru: "Другландия",
  },
];

async function loadFixture(
  dir: string,
): Promise<{ bundle: LoadedBundle; domain: BundleDomain }> {
  buildBundle(dir, KEYS, { contentVersion: "bundle-v1", entities: ENTITIES });
  const bundle = await loadBundle(dir);
  return { bundle, domain: parseBundleDomain(bundle) };
}

describe("uploadBundleAssets", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "content-bundle-assets-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /// Every file a release names has to be somewhere a client can reach, which
  /// until now none of them were.
  it("stores every file the release's assets refer to", async () => {
    const { bundle, domain } = await loadFixture(dir);
    const storage = new InMemoryObjectStorage();

    const result = await uploadBundleAssets(bundle, domain, storage);

    // Two countries, each with a vector and two rasters.
    expect(result).toEqual({ uploaded: 6, unchanged: 0 });
    for (const entity of ENTITIES) {
      const svg = await storage.getObject(
        `content/bundle-v1/assets/svg/${entity.slug}.svg`,
      );
      expect(svg?.toString()).toBe(`<svg>${entity.slug}</svg>`);
      const raster = await storage.getObject(
        `content/bundle-v1/assets/png/${entity.slug}@2x.png`,
      );
      expect(raster?.toString()).toBe(`<svg>${entity.slug}</svg>@2x`);
    }
  });

  it("uploads nothing when the release is published again unchanged", async () => {
    const { bundle, domain } = await loadFixture(dir);
    const storage = new InMemoryObjectStorage();
    await uploadBundleAssets(bundle, domain, storage);

    const again = await uploadBundleAssets(bundle, domain, storage);

    expect(again).toEqual({ uploaded: 0, unchanged: 6 });
  });

  /// The manifest checksums the JSON documents and says nothing about these, so
  /// a file that does not match the registry would otherwise be published as
  /// the flag the release described.
  it("refuses a file whose bytes are not the ones the registry describes", async () => {
    const { bundle, domain } = await loadFixture(dir);
    writeFileSync(
      join(dir, "assets", "svg", "testland.svg"),
      "<svg>tampered</svg>",
    );

    await expect(
      uploadBundleAssets(bundle, domain, new InMemoryObjectStorage()),
    ).rejects.toThrow(/does not match the checksum the registry records/);
  });

  /// The key is the URL. A client is given the address the bucket serves that
  /// key under, so a release cannot record one place and store its files in
  /// another.
  it("addresses assets where it stored them", () => {
    const storage = new InMemoryObjectStorage("https://assets.dev.test");

    const base = assetBaseUrl(storage, "bundle-v1");

    expect(base).toBe("https://assets.dev.test/content/bundle-v1/");
    expect(`${base}assets/svg/testland.svg`).toBe(
      storage.publicUrl("content/bundle-v1/assets/svg/testland.svg"),
    );
  });
});
