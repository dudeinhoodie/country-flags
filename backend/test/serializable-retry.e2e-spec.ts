import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma, PrismaClient } from "@prisma/client";

import { AppModule } from "../src/app/app.module";
import { ApiException } from "../src/common/http/api.exception";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { importTestContent } from "../src/modules/content/import/test-content-importer";
import { SettingsService } from "../src/modules/settings/settings.service";
import { TEST_STUDY_USER_ID } from "../src/modules/study-sessions/fixtures/test-study.fixture";
import { importTestStudySeed } from "../src/modules/study-sessions/import/test-study-seed-importer";
import {
  parseCompleteStudySessionRequest,
  parseCreateStudySessionRequest,
} from "../src/modules/study-sessions/study-session.request";
import { StudySessionsService } from "../src/modules/study-sessions/study-sessions.service";

type Transaction = Prisma.TransactionClient;
type Run = (transaction: Transaction) => Promise<unknown>;
interface TransactionOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxWait?: number;
  timeout?: number;
}
type RunTransaction = (
  run: Run,
  options?: TransactionOptions,
) => Promise<unknown>;

const DECK_ID = "70000000-0000-4000-8000-000000000001";
// Request ids are stored on the audit event, as UUIDs.
const OTHER_DEVICE_REQUEST_ID = "9b000000-0000-4000-8000-000000000001";
const THIS_DEVICE_REQUEST_ID = "9b000000-0000-4000-8000-000000000002";

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

/**
 * Serializable conflicts between real transactions, and what the services do
 * about them (#452).
 *
 * Each case lets the service's first attempt run to the end of its work and
 * then commits a second, concurrent transaction that PostgreSQL cannot order
 * with it: the other side reads what the attempt wrote and writes what the
 * attempt read. That is the shape of an upload of old answers landing while a
 * session opens, made deterministic — the first committer wins, and the
 * attempt is aborted at its commit with SQLSTATE 40001 (Prisma's P2034). The
 * service is expected to come back and succeed; before the fix it answered
 * 500.
 */
describe("serializable writes retried after a conflict (integration)", () => {
  jest.setTimeout(90_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnvironment = process.env.NODE_ENV;
  const originalTestAuthEnabled = process.env.TEST_AUTH_ENABLED;
  const databaseName =
    `country_flags_serializable_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for serializable retry integration tests",
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
        env: {
          ...process.env,
          DATABASE_URL: testDatabaseUrl,
          // The schema's directUrl drives `migrate deploy`; without this the
          // migrations would land on the ambient database, not this test's.
          DIRECT_DATABASE_URL: testDatabaseUrl,
        },
      },
    );
    if (migration.status !== 0) {
      throw new Error(
        `Serializable retry test migration failed:\n${migration.stdout}\n${migration.stderr}`,
      );
    }

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.NODE_ENV = "test";
    process.env.TEST_AUTH_ENABLED = "true";
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    database = app.get(PrismaService);
    await importTestContent(database);
    await importTestStudySeed(database);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    process.env.DATABASE_URL = originalDatabaseUrl;
    process.env.NODE_ENV = originalNodeEnvironment;
    process.env.TEST_AUTH_ENABLED = originalTestAuthEnabled;
    await app?.close();
    if (admin !== undefined) {
      await admin.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
      await admin.$disconnect();
    }
  });

  /**
   * Makes the service's next transaction lose: `interleave` runs inside it,
   * on the attempt's own connection, and may commit other work on another
   * connection before the attempt continues. Later transactions — the retry
   * among them — run untouched. Returns what the first attempt failed with
   * and how many transactions the service opened.
   */
  function loseFirstAttempt(
    interleave: (
      attempt: Transaction,
      run: Run,
      concurrently: RunTransaction,
    ) => Promise<unknown>,
  ): { firstFailure: () => unknown; attempts: () => number } {
    const concurrently = database.$transaction.bind(
      database,
    ) as unknown as RunTransaction;
    let failure: unknown;
    let attempts = 0;
    const spy = jest.spyOn(database, "$transaction") as unknown as jest.Mock;
    spy.mockImplementation((run: Run, options?: TransactionOptions) => {
      attempts += 1;
      if (attempts > 1) return concurrently(run, options);
      return concurrently(
        (attempt) => interleave(attempt, run, concurrently),
        options,
      ).catch((error: unknown) => {
        failure = error;
        throw error;
      });
    });
    return { firstFailure: () => failure, attempts: () => attempts };
  }

  function expectWriteConflict(error: unknown): void {
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe("P2034");
  }

  it("opens a session whose first attempt lost to a concurrent write", async () => {
    const sessionId = "9a000000-0000-4000-8000-000000000001";
    const trace = loseFirstAttempt(async (attempt, run, concurrently) => {
      const result = await run(attempt);
      // The other side reads the session the attempt created, and touches
      // the account row the attempt read to check the learner is active.
      await concurrently(
        async (other) => {
          await other.$queryRaw`SELECT id FROM study_sessions WHERE id = ${sessionId}::uuid`;
          await other.$executeRaw`UPDATE users SET display_name = display_name WHERE id = ${TEST_STUDY_USER_ID}::uuid`;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return result;
    });

    const result = await app.get(StudySessionsService).create(
      TEST_STUDY_USER_ID,
      parseCreateStudySessionRequest({
        id: sessionId,
        deckId: DECK_ID,
        requestedUniqueCount: 5,
        mode: "SELF_RATED",
        locale: "en",
        selectionOrigin: "SERVER",
      }),
    );

    expectWriteConflict(trace.firstFailure());
    // The lost attempt and the retry; the other side ran beside the spy.
    expect(trace.attempts()).toBe(2);
    expect(result.created).toBe(true);
    expect(result.session).toMatchObject({ id: sessionId, status: "ACTIVE" });
    await expect(
      database.studySession.count({ where: { id: sessionId } }),
    ).resolves.toBe(1);
  });

  it("completes a session whose first attempt lost to a concurrent write", async () => {
    const sessionId = "9a000000-0000-4000-8000-000000000002";
    const sessions = app.get(StudySessionsService);
    await sessions.create(
      TEST_STUDY_USER_ID,
      parseCreateStudySessionRequest({
        id: sessionId,
        deckId: DECK_ID,
        requestedUniqueCount: 5,
        mode: "SELF_RATED",
        locale: "en",
        selectionOrigin: "SERVER",
      }),
    );
    const trace = loseFirstAttempt(async (attempt, run, concurrently) => {
      const result = await run(attempt);
      // The other side reads the session the attempt is completing, and
      // touches the session's cards the attempt read.
      await concurrently(
        async (other) => {
          await other.$queryRaw`SELECT status::text FROM study_sessions WHERE id = ${sessionId}::uuid`;
          await other.$executeRaw`UPDATE study_session_cards SET random_seed = random_seed WHERE session_id = ${sessionId}::uuid`;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return result;
    });

    const completed = await sessions.complete(
      TEST_STUDY_USER_ID,
      sessionId,
      parseCompleteStudySessionRequest({
        completedAt: new Date().toISOString(),
      }),
    );

    expectWriteConflict(trace.firstFailure());
    expect(trace.attempts()).toBe(2);
    expect(completed).toMatchObject({ id: sessionId, status: "COMPLETED" });
  });

  it("answers a settings save that lost to another device with the version conflict", async () => {
    const settings = app.get(SettingsService);
    const { version } = await settings.get(TEST_STUDY_USER_ID);
    const trace = loseFirstAttempt(async (attempt, run) => {
      // The attempt takes its snapshot, then the other device's save commits
      // on the same row before the attempt writes it.
      await attempt.$queryRaw`SELECT 1`;
      await settings.update(
        TEST_STUDY_USER_ID,
        version,
        { sessionSize: 10 },
        OTHER_DEVICE_REQUEST_ID,
      );
      return run(attempt);
    });

    const thrown = await settings
      .update(
        TEST_STUDY_USER_ID,
        version,
        { sessionSize: 20 },
        THIS_DEVICE_REQUEST_ID,
      )
      .catch((error: unknown) => error);

    expectWriteConflict(trace.firstFailure());
    // The lost attempt, the other device's save and the retry.
    expect(trace.attempts()).toBe(3);
    expect(thrown).toBeInstanceOf(ApiException);
    expect((thrown as ApiException).getResponse()).toMatchObject({
      error: {
        code: "SETTINGS_VERSION_CONFLICT",
        details: { currentVersion: version + 1 },
      },
    });
    await expect(
      database.userSettings.findUniqueOrThrow({
        where: { userId: TEST_STUDY_USER_ID },
      }),
    ).resolves.toMatchObject({ version: version + 1, sessionSize: 10 });
  });
});
