import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { PrismaClient } from "@prisma/client";

import { InMemoryObjectStorage } from "../../../infrastructure/object-storage/in-memory-object-storage";
import { publishBundle } from "../bundle/bundle-publisher";
import { buildBundle } from "../bundle/test-support/bundle-fixture-builder";
import { CONTENT_BUILD_TIMEOUT_MS } from "./content-build";
import {
  PUBLISH_RUN_HEARTBEAT_INTERVAL_MS,
  PUBLISH_RUN_LEASE_MS,
} from "./publish-run-lease";

const WORKFLOW = resolve(
  __dirname,
  "../../../../../.github/workflows/deploy-publisher-dev.yml",
);

/**
 * Time a publish spends outside the build and the transaction: validating
 * the bundle, one existence check and upload per file, and starting the
 * process. A couple of minutes at most from next to the bucket. The rest is
 * margin.
 */
const OVERHEAD_MS = 5 * 60_000;

function deployedFlag(name: string): string {
  const value = new RegExp(`--${name} (\\S+)`).exec(
    readFileSync(WORKFLOW, "utf8"),
  )?.[1];
  if (value === undefined) {
    throw new Error(`deploy-publisher-dev.yml sets no --${name}`);
  }
  return value;
}

function minutes(value: string): number {
  const match = /^(\d+)m$/.exec(value);
  if (match === null) {
    throw new Error(`Expected a whole number of minutes, read ${value}`);
  }
  return Number(match[1]) * 60_000;
}

/**
 * The transaction options a publish actually asks for, read off the call
 * rather than restated, so a change to the publisher's budget reaches this
 * check without anyone remembering it.
 */
async function releaseTransactionOptions(): Promise<{
  timeout: number;
  maxWait: number;
}> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const dir = mkdtempSync(join(tmpdir(), "publisher-job-budget-"));
  try {
    buildBundle(
      dir,
      {
        keyId: "budget-key",
        privateKeyPem: privateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString(),
      },
      {
        contentVersion: "budget-v1",
        entities: [
          {
            key: "country.testland",
            slug: "testland",
            en: "Testland",
            ru: "Тестландия",
          },
        ],
      },
    );
    let options: { timeout: number; maxWait: number } | undefined;
    const client = {
      contentRelease: { findUnique: () => Promise.resolve(null) },
      $transaction: (
        _work: unknown,
        asked: { timeout: number; maxWait: number },
      ) => {
        options = asked;
        return Promise.resolve({});
      },
    } as unknown as PrismaClient;
    await publishBundle(
      dir,
      {
        "budget-key": publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
      },
      client,
      new InMemoryObjectStorage(),
    );
    if (options === undefined) {
      throw new Error("The publish opened no transaction");
    }
    return options;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The publisher job's own limit against the limits of the work inside it.
 *
 * It was thirty minutes around a fifteen-minute build and a twenty-minute
 * transaction, so a slow publish was killed mid-transaction. A killed job
 * writes nothing on its way out, and its run stayed RUNNING, blocking every
 * later release from the console (#452).
 */
describe("the publisher job's budget", () => {
  it("covers a whole publish: the build, the uploads and the transaction", async () => {
    const { timeout, maxWait } = await releaseTransactionOptions();

    expect(minutes(deployedFlag("task-timeout"))).toBeGreaterThanOrEqual(
      CONTENT_BUILD_TIMEOUT_MS + maxWait + timeout + OVERHEAD_MS,
    );
  });

  /// A retry would find the run no longer queued and exit having done
  /// nothing, so it would only hide that the first attempt died.
  it("does not retry a task", () => {
    expect(deployedFlag("max-retries")).toBe("0");
  });

  /// Ten beats missed before a run counts as abandoned: a single slow write
  /// must not let the console give up a job that is still working.
  it("leaves room for missed heartbeats before a run counts as abandoned", () => {
    expect(PUBLISH_RUN_LEASE_MS).toBeGreaterThanOrEqual(
      10 * PUBLISH_RUN_HEARTBEAT_INTERVAL_MS,
    );
  });
});
