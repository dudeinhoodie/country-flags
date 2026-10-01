// Must be the first import: it fixes the admin environment before
// app.module.ts snapshots process.env through ConfigModule.forRoot.
import {
  originalAdminEnvironment,
  TRUSTED_ORIGIN,
} from "./admin-auth.environment";

import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { AdminRole, PrismaClient } from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { importTestContent } from "../src/modules/content/import/test-content-importer";
import { PrismaPublishRunStore } from "../src/modules/content/publisher/prisma-publish-run-store";
import { TestProviderTokenSigner } from "../src/modules/auth/testing/test-provider-token-signer";
import { bodyOf } from "./response-body";

interface RunBody {
  id: string;
  kind: string;
  status: string;
  contentVersion: string;
  minimumClientVersion: string | null;
  previousVersion: string | null;
  failure: { code: string; message: string } | null;
  createdAt: string;
  heartbeatAt: string | null;
  executorLost: boolean;
  finishedAt: string | null;
}

interface RunStateBody {
  activeVersion: string | null;
  executorConfigured: boolean;
  current: RunBody | null;
  last: RunBody | null;
}

interface ReleaseListBody {
  activeVersion: string | null;
  releases: {
    version: string;
    status: string;
    isActive: boolean;
    publishedAt: string | null;
    retiredAt: string | null;
  }[];
}

interface ErrorBody {
  error: { code: string; message: string };
}

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

function sessionCookieOf(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const cookies: string[] = Array.isArray(header)
    ? header
    : typeof header === "string"
      ? [header]
      : [];
  const cookie = cookies.find((entry) => entry.startsWith("cf_admin_session="));
  if (cookie === undefined) {
    throw new Error("Admin session cookie is missing from the response");
  }
  return cookie;
}

/**
 * Publishing and rolling back from the product (ADR-017).
 *
 * These endpoints queue a run and return; nothing here applies a release.
 * What they are responsible for is the answer a console gets before the work
 * starts — the refusals especially, because a request that cannot succeed
 * should be answered now rather than after twenty minutes of losing a race
 * over the active pointer.
 */
describe("Admin release runs (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalEnvironment = originalAdminEnvironment;
  const databaseName =
    `country_flags_release_runs_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let publisherCookie: string;
  let viewerCookie: string;
  let activeVersion: string;

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error("DATABASE_URL is required for admin integration tests");
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
        env: {
          ...process.env,
          DATABASE_URL: testDatabaseUrl,
          DIRECT_DATABASE_URL: testDatabaseUrl,
        },
      },
    );
    if (migration.status !== 0) {
      throw new Error(
        `Release run test migration failed:\n${migration.stdout}\n${migration.stderr}`,
      );
    }

    process.env.DATABASE_URL = testDatabaseUrl;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const expressApp =
      moduleRef.createNestApplication<NestExpressApplication>();
    expressApp.setGlobalPrefix("v1");
    await expressApp.init();
    app = expressApp;
    httpServer = app.getHttpServer() as Server;
    database = app.get(PrismaService);
    const signer = app.get(TestProviderTokenSigner);

    async function login(subject: string, email: string): Promise<string> {
      const idToken = await signer.signGoogle({ subject, email });
      const response = await request(httpServer)
        .post("/v1/admin/auth/google")
        .set("Origin", TRUSTED_ORIGIN)
        .send({ idToken });
      if (response.status !== 200) {
        throw new Error(`Fixture login failed for ${email}`);
      }
      return sessionCookieOf(response);
    }

    publisherCookie = await login(
      "release-publisher",
      "publisher1@country-flags.test",
    );
    await database.adminUser.update({
      where: { email: "publisher1@country-flags.test" },
      data: { role: AdminRole.PUBLISHER },
    });
    viewerCookie = await login(
      "release-watcher",
      "watcher1@country-flags.test",
    );

    activeVersion = (await importTestContent(database)).version;
  });

  afterEach(async () => {
    // Each case starts with nothing in flight: the partial unique index over
    // the active statuses is exactly what several of them are testing.
    await database.publishRun.deleteMany({});
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await app?.close();
    if (admin !== undefined) {
      await admin.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
      await admin.$disconnect();
    }
  });

  it("queues a publish and reports it as the run in flight", async () => {
    const queued = await request(httpServer)
      .post("/v1/admin/content/releases/publish")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ contentVersion: "fixture-v9", minimumClientVersion: "0.1.0" });

    expect(queued.status).toBe(202);
    const run = bodyOf<RunBody>(queued);
    expect(run).toMatchObject({
      kind: "PUBLISH",
      status: "QUEUED",
      contentVersion: "fixture-v9",
      minimumClientVersion: "0.1.0",
      // The way back is recoverable from the record alone.
      previousVersion: activeVersion,
      failure: null,
      finishedAt: null,
    });

    const state = await request(httpServer)
      .get("/v1/admin/content/releases/runs")
      .set("Cookie", viewerCookie);
    expect(state.status).toBe(200);
    const body = bodyOf<RunStateBody>(state);
    expect(body.activeVersion).toBe(activeVersion);
    expect(body.current?.id).toBe(run.id);
    expect(body.last?.id).toBe(run.id);

    const one = await request(httpServer)
      .get(`/v1/admin/content/releases/runs/${run.id}`)
      .set("Cookie", viewerCookie);
    expect(one.status).toBe(200);
    expect(bodyOf<RunBody>(one).id).toBe(run.id);
  });

  /// Refused at the door rather than queued behind the first: two runs
  /// racing over the active pointer is the thing the record exists to stop.
  it("refuses a second run while one is in flight", async () => {
    const first = await request(httpServer)
      .post("/v1/admin/content/releases/publish")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ contentVersion: "fixture-v9", minimumClientVersion: "0.1.0" });
    expect(first.status).toBe(202);

    const second = await request(httpServer)
      .post("/v1/admin/content/releases/publish")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ contentVersion: "fixture-v10", minimumClientVersion: "0.1.0" });

    expect(second.status).toBe(409);
  });

  /// The publisher would answer "already published", which reads as success
  /// and teaches an operator that nothing they do matters.
  it("refuses to republish the version that is already live", async () => {
    const response = await request(httpServer)
      .post("/v1/admin/content/releases/publish")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ contentVersion: activeVersion, minimumClientVersion: "0.1.0" });

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe(
      "CONTENT_VERSION_ALREADY_ACTIVE",
    );
  });

  /// Returning to a release this deployment never applied would point every
  /// client at nothing.
  it("refuses a rollback to a version that was never published", async () => {
    const response = await request(httpServer)
      .post("/v1/admin/content/releases/rollback")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ toVersion: "fixture-never-was" });

    expect(response.status).toBe(422);
    expect(bodyOf<ErrorBody>(response).error.code).toBe(
      "CONTENT_VERSION_NOT_PUBLISHED",
    );
  });

  /// Without this a run nothing picks up would hold the only live slot for
  /// good, and the database would be the only way to release it.
  it("cancels a queued run and frees the slot", async () => {
    const queued = await request(httpServer)
      .post("/v1/admin/content/releases/publish")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ contentVersion: "fixture-v9", minimumClientVersion: "0.1.0" });
    const runId = bodyOf<RunBody>(queued).id;

    const cancelled = await request(httpServer)
      .post(`/v1/admin/content/releases/runs/${runId}/cancel`)
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN);
    expect(cancelled.status).toBe(200);
    expect(bodyOf<RunBody>(cancelled)).toMatchObject({
      id: runId,
      status: "CANCELLED",
    });
    expect(bodyOf<RunBody>(cancelled).finishedAt).not.toBeNull();

    // The slot is free, which is the whole point.
    const next = await request(httpServer)
      .post("/v1/admin/content/releases/publish")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ contentVersion: "fixture-v10", minimumClientVersion: "0.1.0" });
    expect(next.status).toBe(202);
  });

  /// A job that is still reporting is alive; giving up the record under it
  /// would leave the two disagreeing about what happened.
  it("refuses to give up a running run whose job is still reporting", async () => {
    const queued = await request(httpServer)
      .post("/v1/admin/content/releases/publish")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ contentVersion: "fixture-v9", minimumClientVersion: "0.1.0" });
    const runId = bodyOf<RunBody>(queued).id;
    await database.publishRun.update({
      where: { id: runId },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        heartbeatAt: new Date(),
      },
    });

    const state = await request(httpServer)
      .get("/v1/admin/content/releases/runs")
      .set("Cookie", viewerCookie);
    expect(bodyOf<RunStateBody>(state).current).toMatchObject({
      id: runId,
      status: "RUNNING",
      executorLost: false,
    });

    const response = await request(httpServer)
      .post(`/v1/admin/content/releases/runs/${runId}/cancel`)
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe(
      "PUBLISH_RUN_EXECUTOR_ALIVE",
    );
  });

  /// A killed job writes nothing on its way out. Its run stayed RUNNING and
  /// held the only live slot for good, so every later publish and rollback
  /// from the console was refused (#452).
  it("gives up a running run whose job stopped reporting, and frees the slot", async () => {
    const queued = await request(httpServer)
      .post("/v1/admin/content/releases/publish")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ contentVersion: "fixture-v9", minimumClientVersion: "0.1.0" });
    const runId = bodyOf<RunBody>(queued).id;
    await database.publishRun.update({
      where: { id: runId },
      data: {
        status: "RUNNING",
        stage: "applying",
        startedAt: new Date(Date.now() - 40 * 60_000),
        heartbeatAt: new Date(Date.now() - 6 * 60_000),
      },
    });

    // Refused while the dead run holds the slot, which is the bug.
    const blocked = await request(httpServer)
      .post("/v1/admin/content/releases/publish")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ contentVersion: "fixture-v10", minimumClientVersion: "0.1.0" });
    expect(blocked.status).toBe(409);

    const state = await request(httpServer)
      .get("/v1/admin/content/releases/runs")
      .set("Cookie", viewerCookie);
    expect(bodyOf<RunStateBody>(state).current).toMatchObject({
      id: runId,
      executorLost: true,
    });

    const givenUp = await request(httpServer)
      .post(`/v1/admin/content/releases/runs/${runId}/cancel`)
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN);
    expect(givenUp.status).toBe(200);
    const run = bodyOf<RunBody>(givenUp);
    expect(run).toMatchObject({
      id: runId,
      status: "FAILED",
      executorLost: false,
      failure: { code: "PUBLISH_RUN_EXECUTOR_LOST" },
    });
    expect(run.failure?.message).toContain(activeVersion);
    expect(run.finishedAt).not.toBeNull();

    const audit = await database.adminAuditEvent.findFirst({
      where: { action: "admin.release.run_abandoned", targetId: runId },
    });
    expect(audit).not.toBeNull();

    // The slot is free, which is the whole point.
    const next = await request(httpServer)
      .post("/v1/admin/content/releases/publish")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ contentVersion: "fixture-v10", minimumClientVersion: "0.1.0" });
    expect(next.status).toBe(202);
  });

  /// Giving up a run must be final even if its job was not dead after all:
  /// a late heartbeat or outcome must not bring the run back to life, or two
  /// records would claim the one live slot.
  it("does not let a job revive a run that was given up", async () => {
    const queued = await request(httpServer)
      .post("/v1/admin/content/releases/publish")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ contentVersion: "fixture-v9", minimumClientVersion: "0.1.0" });
    const runId = bodyOf<RunBody>(queued).id;
    const store = new PrismaPublishRunStore(database);

    const claimed = await store.claim(runId, "content-publisher-dev-abcde");
    expect(claimed?.status).toBe("RUNNING");
    // The claim writes the first heartbeat itself.
    expect(claimed?.heartbeatAt).not.toBeNull();

    await database.publishRun.update({
      where: { id: runId },
      data: { heartbeatAt: new Date(Date.now() - 6 * 60_000) },
    });
    const givenUp = await request(httpServer)
      .post(`/v1/admin/content/releases/runs/${runId}/cancel`)
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN);
    expect(givenUp.status).toBe(200);

    await store.heartbeat(runId);
    await store.recordStage(runId, "applying");
    await store.recordSuccess(runId);

    const row = await database.publishRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(row.status).toBe("FAILED");
    expect(row.failureCode).toBe("PUBLISH_RUN_EXECUTOR_LOST");
  });

  /// A RUNNING run without a heartbeat could never be told apart from a
  /// dead one, so the database refuses to hold one.
  it("refuses a running run without a heartbeat", async () => {
    const queued = await request(httpServer)
      .post("/v1/admin/content/releases/publish")
      .set("Cookie", publisherCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ contentVersion: "fixture-v9", minimumClientVersion: "0.1.0" });
    const runId = bodyOf<RunBody>(queued).id;

    await expect(
      database.$executeRawUnsafe(
        `UPDATE publish_runs SET status = 'RUNNING', started_at = now() WHERE id = $1::uuid`,
        runId,
      ),
    ).rejects.toThrow(/publish_runs_running_heartbeat_check/);
  });

  it("refuses a release below PUBLISHER, and from an untrusted origin", async () => {
    const asViewer = await request(httpServer)
      .post("/v1/admin/content/releases/publish")
      .set("Cookie", viewerCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ contentVersion: "fixture-v9", minimumClientVersion: "0.1.0" });
    expect(asViewer.status).toBe(403);

    const noOrigin = await request(httpServer)
      .post("/v1/admin/content/releases/publish")
      .set("Cookie", publisherCookie)
      .send({ contentVersion: "fixture-v9", minimumClientVersion: "0.1.0" });
    expect(noOrigin.status).toBe(403);

    const anonymous = await request(httpServer)
      .post("/v1/admin/content/releases/rollback")
      .set("Origin", TRUSTED_ORIGIN)
      .send({ toVersion: activeVersion });
    expect(anonymous.status).toBe(401);

    // Nothing was recorded by any of the three.
    await expect(database.publishRun.count()).resolves.toBe(0);
  });

  /// A rollback must be offered the versions this deployment actually
  /// applied. A text field would invite a typo the API answers with 422, and
  /// a version another environment published would point clients at nothing.
  it("lists the releases a rollback may return to", async () => {
    const response = await request(httpServer)
      .get("/v1/admin/content/releases")
      .set("Cookie", viewerCookie);

    expect(response.status).toBe(200);
    const body = bodyOf<ReleaseListBody>(response);
    expect(body.activeVersion).toBe(activeVersion);
    const live = body.releases.find(
      (release) => release.version === activeVersion,
    );
    expect(live).toMatchObject({ status: "PUBLISHED", isActive: true });
    expect(live?.publishedAt).not.toBeNull();
  });

  /// Nothing is draining the queue in a deployment with no publisher job,
  /// and a run queued into nothing looks exactly like a slow one unless the
  /// state says so.
  it("says whether anything will execute what is queued", async () => {
    const response = await request(httpServer)
      .get("/v1/admin/content/releases/runs")
      .set("Cookie", viewerCookie);

    expect(response.status).toBe(200);
    // The integration environment configures no PUBLISHER_JOB_*, which is
    // the state the console has to be honest about.
    expect(bodyOf<RunStateBody>(response).executorConfigured).toBe(false);
  });

  it("reads an unknown run as missing rather than as an empty one", async () => {
    const response = await request(httpServer)
      .get(
        "/v1/admin/content/releases/runs/ffffffff-ffff-4fff-8fff-ffffffffffff",
      )
      .set("Cookie", viewerCookie);

    expect(response.status).toBe(404);
  });
});
