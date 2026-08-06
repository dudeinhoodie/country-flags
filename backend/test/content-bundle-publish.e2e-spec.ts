import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ContentReleaseStatus, PrismaClient } from "@prisma/client";

import { InMemoryObjectStorage } from "../src/infrastructure/object-storage/in-memory-object-storage";
import { publishBundle } from "../src/modules/content/bundle/bundle-publisher";
import { rollbackContentVersion } from "../src/modules/content/bundle/bundle-rollback";
import { BundleValidationError } from "../src/modules/content/bundle/bundle-validator";
import { buildBundle } from "../src/modules/content/bundle/test-support/bundle-fixture-builder";

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

describe("content bundle publish/rollback pipeline (integration)", () => {
  jest.setTimeout(90_000);

  const baseUrl = process.env.DATABASE_URL;
  const databaseName =
    `country_flags_bundle_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaClient;
  let tempDir: string;
  const storage = new InMemoryObjectStorage();

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyId = "e2e-key";
  const privateKeyPem = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const publicKeyPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const publicKeys = { [keyId]: publicKeyPem };

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for content bundle integration tests",
      );
    }

    admin = new PrismaClient({ datasources: { db: { url: baseUrl } } });
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);

    const testDatabaseUrl = databaseUrlFor(baseUrl, databaseName);
    const prismaCli = require.resolve("prisma/build/index.js");
    const migration = spawnSync(
      process.execPath,
      [
        prismaCli,
        "migrate",
        "deploy",
        "--schema",
        resolve(__dirname, "../prisma/schema.prisma"),
      ],
      {
        cwd: resolve(__dirname, ".."),
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      },
    );
    if (migration.status !== 0) {
      throw new Error(
        `Content bundle test migration failed:\n${migration.stdout}\n${migration.stderr}`,
      );
    }

    database = new PrismaClient({
      datasources: { db: { url: testDatabaseUrl } },
    });
    tempDir = mkdtempSync(join(tmpdir(), "content-bundle-e2e-"));
  });

  afterAll(async () => {
    await database?.$disconnect();
    if (admin !== undefined) {
      await admin.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
      await admin.$disconnect();
    }
    if (tempDir !== undefined) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const testland = {
    key: "country.testland",
    slug: "testland",
    en: "Testland",
    ru: "Тестландия",
  };
  const testopia = {
    key: "country.testopia",
    slug: "testopia",
    en: "Testopia",
    ru: "Тестопия",
  };
  const testeria = {
    key: "country.testeria",
    slug: "testeria",
    en: "Testeria",
    ru: "Тестерия",
  };

  it("rejects an invalid bundle without moving the active pointer", async () => {
    const invalidDir = join(tempDir, "invalid-v1");
    buildBundle(
      invalidDir,
      { keyId, privateKeyPem },
      {
        contentVersion: "invalid-v1",
        entities: [testland],
        breakSignature: true,
      },
    );

    await expect(
      publishBundle(invalidDir, publicKeys, database, storage),
    ).rejects.toThrow(BundleValidationError);

    const pointer = await database.contentPointer.findUnique({
      where: { key: "active" },
    });
    expect(pointer).toBeNull();
    const release = await database.contentRelease.findUnique({
      where: { version: "invalid-v1" },
    });
    expect(release).toBeNull();
  });

  it("publishes a valid bundle atomically", async () => {
    const v1Dir = join(tempDir, "bundle-v1");
    buildBundle(
      v1Dir,
      { keyId, privateKeyPem },
      {
        contentVersion: "bundle-v1",
        entities: [testland, testopia],
      },
    );

    const summary = await publishBundle(v1Dir, publicKeys, database, storage);

    expect(summary).toMatchObject({
      version: "bundle-v1",
      previousActiveVersion: null,
      alreadyPublished: false,
      counts: {
        entities: 2,
        assets: 2,
        decks: 1,
        cardTemplates: 1,
        learningCards: 2,
      },
    });

    const pointer = await database.contentPointer.findUniqueOrThrow({
      where: { key: "active" },
    });
    expect(pointer.contentVersion).toBe("bundle-v1");

    const release = await database.contentRelease.findUniqueOrThrow({
      where: { version: "bundle-v1" },
    });
    expect(release.status).toBe(ContentReleaseStatus.PUBLISHED);

    const deck = await database.deck.findUniqueOrThrow({
      where: { code: "deck.all" },
      include: { cards: true },
    });
    expect(deck.cards).toHaveLength(2);
  });

  it("republishing the same version is a no-op", async () => {
    const v1Dir = join(tempDir, "bundle-v1");
    const summary = await publishBundle(v1Dir, publicKeys, database, storage);
    expect(summary.alreadyPublished).toBe(true);
  });

  it("publishing a new version retires dropped resources and adds new ones without deleting history", async () => {
    const v2Dir = join(tempDir, "bundle-v2");
    buildBundle(
      v2Dir,
      { keyId, privateKeyPem },
      {
        contentVersion: "bundle-v2",
        entities: [testland, testeria],
      },
    );

    const summary = await publishBundle(v2Dir, publicKeys, database, storage);
    expect(summary.previousActiveVersion).toBe("bundle-v1");

    const pointer = await database.contentPointer.findUniqueOrThrow({
      where: { key: "active" },
    });
    expect(pointer.contentVersion).toBe("bundle-v2");

    const previousRelease = await database.contentRelease.findUniqueOrThrow({
      where: { version: "bundle-v1" },
    });
    expect(previousRelease.status).toBe(ContentReleaseStatus.RETIRED);

    // Testopia was dropped from bundle-v2: its rows must survive (no history
    // loss) but must no longer be served.
    const testopiaRow = await database.geoEntity.findUniqueOrThrow({
      where: { contentKey: testopia.key },
      include: { learningCards: { include: { deckCards: true } } },
    });
    expect(testopiaRow.contentVersion).toBe("bundle-v1");
    expect(testopiaRow.status).toBe("HIDDEN");
    expect(testopiaRow.learningCards).toHaveLength(1);
    expect(testopiaRow.learningCards[0]?.status).toBe("RETIRED");
    expect(testopiaRow.learningCards[0]?.deckCards).toHaveLength(0);

    const testeriaRow = await database.geoEntity.findUniqueOrThrow({
      where: { contentKey: testeria.key },
    });
    expect(testeriaRow.contentVersion).toBe("bundle-v2");

    const retireChange = await database.contentChange.findFirst({
      where: {
        contentVersion: "bundle-v2",
        operation: "RETIRE",
        resourceId: testopiaRow.id,
      },
    });
    expect(retireChange).not.toBeNull();
  });

  it("rolls back to the previous version and restores its data", async () => {
    const summary = await rollbackContentVersion(
      database,
      storage,
      "bundle-v1",
    );
    expect(summary).toMatchObject({
      targetVersion: "bundle-v1",
      previousActiveVersion: "bundle-v2",
      alreadyActive: false,
    });

    const pointer = await database.contentPointer.findUniqueOrThrow({
      where: { key: "active" },
    });
    expect(pointer.contentVersion).toBe("bundle-v1");

    const v1Release = await database.contentRelease.findUniqueOrThrow({
      where: { version: "bundle-v1" },
    });
    expect(v1Release.status).toBe(ContentReleaseStatus.PUBLISHED);
    const v2Release = await database.contentRelease.findUniqueOrThrow({
      where: { version: "bundle-v2" },
    });
    expect(v2Release.status).toBe(ContentReleaseStatus.RETIRED);

    // Testopia (v1-only) is restored to active service, and testeria
    // (v2-only) survives as history but stops being served.
    const testopiaRow = await database.geoEntity.findUniqueOrThrow({
      where: { contentKey: testopia.key },
      include: { learningCards: { include: { deckCards: true } } },
    });
    expect(testopiaRow.status).toBe("ACTIVE");
    expect(testopiaRow.learningCards[0]?.status).toBe("ACTIVE");
    expect(testopiaRow.learningCards[0]?.deckCards).toHaveLength(1);

    const testeriaRow = await database.geoEntity.findUniqueOrThrow({
      where: { contentKey: testeria.key },
      include: { learningCards: true },
    });
    expect(testeriaRow.status).toBe("HIDDEN");
    expect(testeriaRow.learningCards[0]?.status).toBe("RETIRED");

    const auditEvent = await database.auditEvent.findFirst({
      where: { action: "content.rollback", targetId: "bundle-v1" },
    });
    expect(auditEvent).not.toBeNull();
  });

  it("rejects rollback to an unknown version", async () => {
    await expect(
      rollbackContentVersion(database, storage, "does-not-exist"),
    ).rejects.toThrow(/does not exist/);
  });
});
