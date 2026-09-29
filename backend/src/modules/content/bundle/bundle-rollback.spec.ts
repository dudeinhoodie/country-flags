import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ContentReleaseStatus, type PrismaClient } from "@prisma/client";

import { InMemoryObjectStorage } from "../../../infrastructure/object-storage/in-memory-object-storage";
import { publishBundle } from "./bundle-publisher";
import { rollbackContentVersion } from "./bundle-rollback";
import type { ContentManifest } from "./bundle-types";
import { buildBundle } from "./test-support/bundle-fixture-builder";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const KEY_ID = "test-key";
const SIGNING = {
  keyId: KEY_ID,
  privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
const PUBLIC_KEYS = {
  [KEY_ID]: publicKey.export({ type: "spki", format: "pem" }).toString(),
};

type TransactionOptions = Record<string, unknown> | undefined;

/**
 * A client that answers the reads made before a release transaction opens,
 * and records how that transaction was asked for instead of running it. The
 * work inside is covered on PostgreSQL by the publish e2e suite. What this
 * pins is the budget, which only shows up at the scale of a real catalogue.
 */
function recordingClient(release: unknown): {
  client: PrismaClient;
  options: TransactionOptions[];
} {
  const options: TransactionOptions[] = [];
  const client = {
    contentRelease: { findUnique: () => Promise.resolve(release) },
    contentPointer: { findUnique: () => Promise.resolve(null) },
    $transaction: (_work: unknown, transactionOptions: TransactionOptions) => {
      options.push(transactionOptions);
      return Promise.resolve({});
    },
  } as unknown as PrismaClient;
  return { client, options };
}

describe("rollbackContentVersion", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "content-bundle-rollback-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * A rollback re-applies the whole target bundle, the same work a publish
   * does inside its transaction. It had five minutes against the publish's
   * twenty. Re-applying an already-published release on dev takes eleven to
   * sixteen of them from a CI runner, so a rollback during an incident would
   * have timed out and left the bad release active (#441).
   */
  it("gets the same transaction budget as the publish it undoes", async () => {
    buildBundle(dir, SIGNING, {
      contentVersion: "bundle-v1",
      entities: [
        {
          key: "country.testland",
          slug: "testland",
          en: "Testland",
          ru: "Тестландия",
        },
      ],
    });
    // The same storage for both: the publish leaves the bundle where the
    // rollback reads it back from.
    const storage = new InMemoryObjectStorage();

    const publishing = recordingClient(null);
    await publishBundle(dir, PUBLIC_KEYS, publishing.client, storage);

    const manifest = JSON.parse(
      readFileSync(join(dir, "manifest.json"), "utf8"),
    ) as ContentManifest;
    const rollingBack = recordingClient({
      version: "bundle-v1",
      status: ContentReleaseStatus.RETIRED,
      metadata: { manifest },
    });
    await rollbackContentVersion(rollingBack.client, storage, "bundle-v1");

    expect(publishing.options).toHaveLength(1);
    expect(rollingBack.options).toEqual(publishing.options);
    expect(rollingBack.options[0]).toMatchObject({
      isolationLevel: "Serializable",
      timeout: 20 * 60 * 1000,
    });
  });
});
