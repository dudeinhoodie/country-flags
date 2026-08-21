import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { AccountDeletionService } from "../src/modules/account-lifecycle/account-deletion.service";
import { TestProviderTokenSigner } from "../src/modules/auth/testing/test-provider-token-signer";
import { TEST_CONTENT_FIXTURE } from "../src/modules/content/fixtures/test-content.fixture";
import { importTestContent } from "../src/modules/content/import/test-content-importer";
import { importTestStudySeed } from "../src/modules/study-sessions/import/test-study-seed-importer";

interface AuthBody {
  tokens: { accessToken: string };
  user: { id: string };
}

interface ErrorBody {
  error: { code: string };
}

interface ReauthenticationBody {
  reauthenticationToken: string;
  expiresAt: string;
}

interface DataExportBody {
  id: string;
  status: string;
  downloadUrl: string | null;
  sha256: string | null;
  expiresAt: string | null;
}

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

function device(clientGeneratedId: string): Record<string, unknown> {
  return {
    clientGeneratedId,
    platform: "IOS",
    appVersion: "1.0.0",
    locale: "ru",
    timezone: "Europe/Moscow",
  };
}

describe("settings, devices, imports and account lifecycle (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    TEST_AUTH_ENABLED: process.env.TEST_AUTH_ENABLED,
    AUTH_PROVIDER_TEST_TOKENS_ENABLED:
      process.env.AUTH_PROVIDER_TEST_TOKENS_ENABLED,
  };
  const databaseName =
    `country_flags_account_${process.pid}_${Date.now()}`.toLowerCase();
  const googleSubject = "account-lifecycle-google-subject";
  let testDatabaseUrl: string;
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let signer: TestProviderTokenSigner;
  let account: AuthBody;
  let secondDeviceAccount: AuthBody;
  let reauthenticationToken: string;

  async function login(deviceId: string): Promise<AuthBody> {
    const idToken = await signer.signGoogle({
      subject: googleSubject,
      email: "lifecycle@example.test",
    });
    const response = await request(httpServer)
      .post("/v1/auth/google")
      .send({ idToken, device: device(deviceId) })
      .expect(200);
    return response.body as unknown as AuthBody;
  }

  async function reauthenticate(): Promise<string> {
    const idToken = await signer.signGoogle({ subject: googleSubject });
    const response = await request(httpServer)
      .post("/v1/auth/reauth/google")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .send({ idToken })
      .expect(200);
    const body = response.body as unknown as ReauthenticationBody;
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    return body.reauthenticationToken;
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for account lifecycle integration tests",
      );
    }
    admin = new PrismaClient({ datasources: { db: { url: baseUrl } } });
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    testDatabaseUrl = databaseUrlFor(baseUrl, databaseName);
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
        `Account lifecycle migration failed:\n${migration.stdout}\n${migration.stderr}`,
      );
    }

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.NODE_ENV = "test";
    process.env.TEST_AUTH_ENABLED = "true";
    process.env.AUTH_PROVIDER_TEST_TOKENS_ENABLED = "true";
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
    signer = app.get(TestProviderTokenSigner);

    await importTestContent(database);
    await importTestStudySeed(database);
    account = await login("account-device-primary-0001");
    secondDeviceAccount = await login("account-device-secondary-01");
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

  it("synchronizes canonical profile and versioned settings", async () => {
    const profile = await request(httpServer)
      .patch("/v1/me")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .send({ displayName: "Flags Learner", preferredLocale: "en-us" })
      .expect(200);
    expect(profile.body).toMatchObject({
      id: account.user.id,
      displayName: "Flags Learner",
      preferredLocale: "en-US",
      status: "ACTIVE",
    });

    const initial = await request(httpServer)
      .get("/v1/me/settings")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .expect(200);
    expect(initial.headers.etag).toBe('W/"1"');
    expect(initial.body).toMatchObject({
      sessionSize: 10,
      contentLocale: "ru",
      timezone: "Europe/Moscow",
      version: 1,
    });

    const invalid = await request(httpServer)
      .patch("/v1/me/settings")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .set("If-Match", 'W/"1"')
      .send({ sessionSize: 15 })
      .expect(422);
    expect((invalid.body as unknown as ErrorBody).error.code).toBe(
      "VALIDATION_FAILED",
    );

    const updated = await request(httpServer)
      .patch("/v1/me/settings")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .set("If-Match", 'W/"1"')
      .send({
        sessionSize: 20,
        contentLocale: "en-US",
        reminderWeekdays: [5, 1, 3],
        desiredRetention: 0.91,
      })
      .expect(200);
    expect(updated.headers.etag).toBe('W/"2"');
    expect(updated.body).toMatchObject({
      sessionSize: 20,
      contentLocale: "en-US",
      reminderWeekdays: [1, 3, 5],
      desiredRetention: 0.91,
      version: 2,
    });

    // Settings are account-scoped, not per-device — a second logged-in device
    // must see the same update, not just the device that made it.
    const fromSecondDevice = await request(httpServer)
      .get("/v1/me/settings")
      .set("Authorization", `Bearer ${secondDeviceAccount.tokens.accessToken}`)
      .expect(200);
    expect(fromSecondDevice.headers.etag).toBe('W/"2"');
    expect(fromSecondDevice.body).toMatchObject({
      sessionSize: 20,
      contentLocale: "en-US",
      reminderWeekdays: [1, 3, 5],
      desiredRetention: 0.91,
      version: 2,
    });

    const stale = await request(httpServer)
      .patch("/v1/me/settings")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .set("If-Match", 'W/"1"')
      .send({ sessionSize: 5 })
      .expect(409);
    expect((stale.body as unknown as ErrorBody).error.code).toBe(
      "SETTINGS_VERSION_CONFLICT",
    );
  });

  it("lists safe device metadata and revokes every session for a removed device", async () => {
    const listed = await request(httpServer)
      .get("/v1/me/devices")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .expect(200);
    const items = (
      listed.body as unknown as {
        items: Array<{
          id: string;
          current: boolean;
          clientGeneratedId?: string;
        }>;
      }
    ).items;
    expect(items).toHaveLength(2);
    expect(items.some(({ current }) => current)).toBe(true);
    expect(items.every((item) => item.clientGeneratedId === undefined)).toBe(
      true,
    );
    const secondarySession = await database.refreshSession.findFirstOrThrow({
      where: {
        userId: account.user.id,
        device: { clientGeneratedId: "account-device-secondary-01" },
        revokedAt: null,
      },
      select: { deviceId: true },
    });
    await request(httpServer)
      .delete(`/v1/me/devices/${secondarySession.deviceId}`)
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .expect(204);
    await request(httpServer)
      .get("/v1/me")
      .set("Authorization", `Bearer ${secondDeviceAccount.tokens.accessToken}`)
      .expect(401);
  });

  it("imports guest reviews once for a stable migration ID", async () => {
    const deckId = "70000000-0000-4000-8000-000000000001";
    const membership = await database.deckCard.findFirstOrThrow({
      where: {
        deckId,
        learningCard: {
          revisions: { some: { contentVersion: TEST_CONTENT_FIXTURE.version } },
        },
      },
      select: {
        learningCardId: true,
        learningCard: { select: { subjectEntityId: true } },
      },
    });
    const migrationId = "a1000000-0000-4000-8000-000000000001";
    const sessionId = "a2000000-0000-4000-8000-000000000001";
    const reviewId = "a3000000-0000-4000-8000-000000000001";
    const payload = {
      payloadVersion: 1,
      migrationId,
      sourceInstallId: "guest-install-account-0001",
      sessions: [
        {
          id: sessionId,
          deckId,
          mode: "SELF_RATED",
          requestedUniqueCount: 5,
          contentVersion: TEST_CONTENT_FIXTURE.version,
          startedAt: "2026-07-29T12:00:00.000Z",
          completedAt: "2026-07-29T12:05:00.000Z",
        },
      ],
      reviews: [
        {
          id: reviewId,
          sessionId,
          learningCardId: membership.learningCardId,
          answerMode: "SELF_RATED",
          rating: "GOOD",
          clientOccurredAt: "2026-07-29T12:01:00.000Z",
          clientSequence: 1,
          responseTimeMs: 2500,
        },
      ],
    };

    const first = await request(httpServer)
      .post("/v1/me/guest-imports")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .send(payload)
      .expect(202);
    expect(first.body).toMatchObject({
      migrationId,
      status: "APPLIED",
      acceptedEventCount: 1,
      duplicateEventCount: 0,
      rejectedEventCount: 0,
    });
    const repeated = await request(httpServer)
      .post("/v1/me/guest-imports")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .send(payload)
      .expect(202);
    expect(repeated.body).toEqual(first.body);
    await expect(
      database.reviewEvent.count({
        where: { userId: account.user.id, id: reviewId },
      }),
    ).resolves.toBe(1);

    const distractors = await database.geoEntity.findMany({
      where: {
        id: { not: membership.learningCard.subjectEntityId },
        status: "ACTIVE",
        kind: "COUNTRY",
      },
      orderBy: { id: "asc" },
      take: 3,
      select: { id: true },
    });
    expect(distractors).toHaveLength(3);
    const optionIds = [
      "b1000000-0000-4000-8000-000000000001",
      "b1000000-0000-4000-8000-000000000002",
      "b1000000-0000-4000-8000-000000000003",
      "b1000000-0000-4000-8000-000000000004",
    ];
    const objectiveReviewId = "b3000000-0000-4000-8000-000000000001";
    const objective = await request(httpServer)
      .post("/v1/me/guest-imports")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .send({
        payloadVersion: 1,
        migrationId: "b4000000-0000-4000-8000-000000000001",
        sourceInstallId: "guest-install-account-0001",
        sessions: [
          {
            id: "b2000000-0000-4000-8000-000000000001",
            deckId,
            mode: "MULTIPLE_CHOICE",
            requestedUniqueCount: 5,
            contentVersion: TEST_CONTENT_FIXTURE.version,
            startedAt: "2026-07-29T13:00:00.000Z",
            completedAt: "2026-07-29T13:05:00.000Z",
          },
        ],
        reviews: [
          {
            id: objectiveReviewId,
            sessionId: "b2000000-0000-4000-8000-000000000001",
            learningCardId: membership.learningCardId,
            answerMode: "MULTIPLE_CHOICE",
            selectedOptionId: optionIds[0],
            options: [
              {
                id: optionIds[0],
                answerEntityId: membership.learningCard.subjectEntityId,
              },
              ...distractors.map(({ id }, index) => ({
                id: optionIds[index + 1],
                answerEntityId: id,
              })),
            ],
            clientOccurredAt: "2026-07-29T13:01:00.000Z",
            clientSequence: 2,
          },
        ],
      })
      .expect(202);
    expect(objective.body).toMatchObject({
      status: "APPLIED",
      acceptedEventCount: 1,
      rejectedEventCount: 0,
    });
    await expect(
      database.reviewEvent.findUniqueOrThrow({
        where: {
          userId_id: { userId: account.user.id, id: objectiveReviewId },
        },
        select: { rating: true, isCorrect: true },
      }),
    ).resolves.toEqual({ rating: "GOOD", isCorrect: true });
  });

  /// Ages the session so it no longer counts as freshly authenticated.
  ///
  /// A sign-in younger than `AUTH_REAUTH_TOKEN_TTL_SECONDS` is itself the proof
  /// a sensitive operation asks for — nobody is sent through a provider twice
  /// in the same minute. Everything in this file signs in during setup, so a
  /// test that wants to see the refusal has to let the session go cold first.
  async function ageTheSignIn(): Promise<void> {
    await database.refreshSession.updateMany({
      where: { userId: account.user.id },
      data: { createdAt: new Date(Date.now() - 60 * 60_000) },
    });
  }

  it("takes a fresh sign-in as its own proof", async () => {
    // Signing in *is* proving who you are. The session here is seconds old, so
    // asking for a copy of the account's data must not send anybody back
    // through a provider.
    const created = await request(httpServer)
      .post("/v1/me/data-exports")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .expect(202);
    expect((created.body as unknown as { id: string }).id).toBeDefined();
  });

  it("requires fresh reauthentication and expires signed export URLs", async () => {
    await ageTheSignIn();

    const withoutProof = await request(httpServer)
      .post("/v1/me/data-exports")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .expect(401);
    expect((withoutProof.body as unknown as ErrorBody).error.code).toBe(
      "REAUTHENTICATION_REQUIRED",
    );

    const staleIssuedAt = new Date(Date.now() - 10 * 60_000);
    const staleProviderToken = await signer.signGoogle({
      subject: googleSubject,
      issuedAt: staleIssuedAt,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const staleProof = await request(httpServer)
      .post("/v1/auth/reauth/google")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .send({ idToken: staleProviderToken })
      .expect(401);
    expect((staleProof.body as unknown as ErrorBody).error.code).toBe(
      "REAUTHENTICATION_NOT_FRESH",
    );

    reauthenticationToken = await reauthenticate();
    const created = await request(httpServer)
      .post("/v1/me/data-exports")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .set("X-Reauthentication-Token", reauthenticationToken)
      .expect(202);
    expect(created.body).toMatchObject({ status: "PENDING" });
    let dataExport = created.body as unknown as DataExportBody;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const status = await request(httpServer)
        .get(`/v1/me/data-exports/${dataExport.id}`)
        .set("Authorization", `Bearer ${account.tokens.accessToken}`)
        .expect(200);
      dataExport = status.body as unknown as DataExportBody;
      if (dataExport.status === "READY") {
        break;
      }
      await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 10));
    }
    expect(dataExport.status).toBe("READY");
    expect(dataExport.downloadUrl).not.toBeNull();
    expect(dataExport.sha256).toMatch(/^[a-f0-9]{64}$/);
    const downloadUrl = new URL(dataExport.downloadUrl!);
    const downloaded = await request(httpServer)
      .get(`${downloadUrl.pathname}${downloadUrl.search}`)
      .expect(200);
    expect(downloaded.body).toMatchObject({
      schemaVersion: 1,
      profile: { id: account.user.id },
      authenticationProviders: [{ provider: "GOOGLE" }],
    });
    expect(JSON.stringify(downloaded.body)).not.toContain(
      "lifecycle@example.test",
    );
    expect(JSON.stringify(downloaded.body)).not.toContain("accessToken");

    await database.dataExportRequest.update({
      where: { id: dataExport.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await request(httpServer)
      .get(`${downloadUrl.pathname}${downloadUrl.search}`)
      .expect(404);
  });

  it("clears learning progress, rotates the sync stream, and keeps the account", async () => {
    await expect(
      database.reviewEvent.count({ where: { userId: account.user.id } }),
    ).resolves.toBeGreaterThan(0);
    await expect(
      database.userCardState.count({ where: { userId: account.user.id } }),
    ).resolves.toBeGreaterThan(0);
    const changesBefore = await request(httpServer)
      .get("/v1/me/changes")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .expect(200);
    const staleCursor = (
      changesBefore.body as unknown as { nextCursor: string }
    ).nextCursor;

    await ageTheSignIn();
    const withoutProof = await request(httpServer)
      .delete("/v1/me/progress")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .send({ confirmation: "DELETE_PROGRESS" })
      .expect(401);
    expect((withoutProof.body as unknown as ErrorBody).error.code).toBe(
      "REAUTHENTICATION_REQUIRED",
    );

    const unconfirmed = await request(httpServer)
      .delete("/v1/me/progress")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .set("X-Reauthentication-Token", await reauthenticate())
      .send({ confirmation: "DELETE_EVERYTHING" })
      .expect(422);
    expect((unconfirmed.body as unknown as ErrorBody).error.code).toBe(
      "VALIDATION_FAILED",
    );

    const cleared = await request(httpServer)
      .delete("/v1/me/progress")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .set("X-Reauthentication-Token", await reauthenticate())
      .send({ confirmation: "DELETE_PROGRESS" })
      .expect(202);
    expect(cleared.body).toMatchObject({ status: "COMPLETED" });
    const clearedBody = cleared.body as unknown as {
      operationId: string;
      requestedAt: string;
    };
    expect(clearedBody.operationId).toMatch(/^[0-9a-f-]{36}$/iu);
    expect(new Date(clearedBody.requestedAt).getTime()).not.toBeNaN();

    const scopes = { where: { userId: account.user.id } };
    await expect(database.reviewEvent.count(scopes)).resolves.toBe(0);
    await expect(database.userCardState.count(scopes)).resolves.toBe(0);
    await expect(database.studySession.count(scopes)).resolves.toBe(0);
    await expect(database.userAchievement.count(scopes)).resolves.toBe(0);
    await expect(database.userDeckMastery.count(scopes)).resolves.toBe(0);
    await expect(database.userChange.count(scopes)).resolves.toBe(0);
    await expect(database.learningOutboxEvent.count(scopes)).resolves.toBe(0);

    // The account itself, its identities, devices and settings survive.
    await request(httpServer)
      .get("/v1/me")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .expect(200);
    await expect(database.authIdentity.count(scopes)).resolves.toBeGreaterThan(
      0,
    );
    await expect(database.device.count(scopes)).resolves.toBeGreaterThan(0);
    await expect(database.userSettings.count(scopes)).resolves.toBe(1);

    // A cursor issued before the deletion no longer resolves, so every device
    // resynchronizes from an empty progress stream instead of keeping state
    // the account no longer has.
    const stale = await request(httpServer)
      .get("/v1/me/changes")
      .query({ after: staleCursor })
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .expect(400);
    expect((stale.body as unknown as ErrorBody).error.code).toBe(
      "VALIDATION_FAILED",
    );
    const rebuilt = await request(httpServer)
      .get("/v1/me/changes")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .expect(200);
    expect(rebuilt.body).toMatchObject({ items: [], hasMore: false });
    expect(
      (rebuilt.body as unknown as { nextCursor: string }).nextCursor,
    ).not.toBe(staleCursor);

    const progress = await request(httpServer)
      .get("/v1/me/progress")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .expect(200);
    expect(progress.body).toMatchObject({
      learnedCards: 0,
      reviewCount: 0,
      currentMasteryTier: "NONE",
      highestAchievementTier: "NONE",
    });

    const audit = await database.auditEvent.findFirst({
      where: {
        actorUserId: account.user.id,
        action: "ACCOUNT_PROGRESS_DELETED",
      },
    });
    expect(audit).not.toBeNull();
  });

  it("deletes account data, revokes sessions, and is service-idempotent", async () => {
    reauthenticationToken = await reauthenticate();
    const deletion = await request(httpServer)
      .delete("/v1/me")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .set("X-Reauthentication-Token", reauthenticationToken)
      .expect(202);
    expect(deletion.body).toMatchObject({
      status: "DELETION_PENDING",
    });

    const idempotent = await app
      .get(AccountDeletionService)
      .delete(account.user.id, randomUUID());
    expect(idempotent).toEqual(deletion.body);
    const user = await database.user.findUniqueOrThrow({
      where: { id: account.user.id },
    });
    expect(user).toMatchObject({
      status: "DELETED",
      displayName: null,
      preferredLocale: "und",
    });
    await expect(
      database.authIdentity.count({ where: { userId: account.user.id } }),
    ).resolves.toBe(0);
    await expect(
      database.refreshSession.count({ where: { userId: account.user.id } }),
    ).resolves.toBe(0);
    await expect(
      database.reviewEvent.count({ where: { userId: account.user.id } }),
    ).resolves.toBe(0);
    await expect(
      database.dataExportRequest.count({ where: { userId: account.user.id } }),
    ).resolves.toBe(0);
    await request(httpServer)
      .get("/v1/me")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .expect(401);
  });
});
