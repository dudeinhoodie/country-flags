import { InMemoryObjectStorage } from "../../infrastructure/object-storage/in-memory-object-storage";
import {
  describeSiteObjectStorage,
  siteObjectStorageEnvironment,
  SiteSnapshotStore,
} from "./site-snapshot-store";

describe("site object storage", () => {
  it("falls back to the in-process store when nothing is configured", () => {
    expect(describeSiteObjectStorage({})).toEqual({
      configured: false,
      publicBaseUrl: null,
    });
  });

  it("maps the SITE_ prefix onto the shared adapter's variables", () => {
    const env = siteObjectStorageEnvironment({
      SITE_OBJECT_STORAGE_PROVIDER: "s3",
      SITE_OBJECT_STORAGE_BUCKET: "country-flags-site-dev",
      SITE_OBJECT_STORAGE_PUBLIC_BASE_URL:
        "https://storage.googleapis.com/country-flags-site-dev/",
      SITE_OBJECT_STORAGE_ACCESS_KEY_ID: "id",
      SITE_OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
      // The content bucket's own variables must not leak into the site's.
      OBJECT_STORAGE_BUCKET: "country-flags-dev",
    });
    expect(env.OBJECT_STORAGE_PROVIDER).toBe("s3");
    expect(env.OBJECT_STORAGE_BUCKET).toBe("country-flags-site-dev");
    expect(describeSiteObjectStorage(env)).toEqual({
      configured: true,
      publicBaseUrl: "https://storage.googleapis.com/country-flags-site-dev",
    });
  });
});

describe("SiteSnapshotStore", () => {
  it("writes the index and the documents with a short cache", async () => {
    const storage = new InMemoryObjectStorage("https://site.test");
    const store = new SiteSnapshotStore(storage);
    await store.writeDocument({
      slug: "privacy",
      locale: "ru",
      title: "Политика",
      version: 2,
      publishedAt: "2026-09-15T10:00:00.000Z",
      html: "<p>x</p>",
    });
    await store.writeIndex({
      generatedAt: "2026-09-15T10:00:00.000Z",
      documents: [],
    });

    expect(storage.keys()).toEqual([
      "documents/index.json",
      "documents/privacy.ru.json",
    ]);
    expect(storage.describe("documents/privacy.ru.json")).toEqual({
      contentType: "application/json",
      cacheControl: "public, max-age=60",
    });
    const written = await storage.getObject("documents/privacy.ru.json");
    expect(JSON.parse(written?.toString("utf8") ?? "")).toMatchObject({
      slug: "privacy",
      locale: "ru",
      html: "<p>x</p>",
    });
    expect(store.indexUrl()).toBe("https://site.test/documents/index.json");

    await store.removeDocument("privacy", "ru");
    expect(storage.keys()).toEqual(["documents/index.json"]);
  });
});
