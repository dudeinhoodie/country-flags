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
import { TestJwtSigner } from "../src/modules/auth/testing/test-jwt-signer";
import { TestProviderTokenSigner } from "../src/modules/auth/testing/test-provider-token-signer";
import { importTestContent } from "../src/modules/content/import/test-content-importer";
import { reviewedTodayCount } from "../src/modules/progress/daily-review-limit";
import { TEST_STUDY_USER_ID } from "../src/modules/study-sessions/fixtures/test-study.fixture";
import { importTestStudySeed } from "../src/modules/study-sessions/import/test-study-seed-importer";
import { bodyOf } from "./response-body";

interface AuthBody {
  tokens: { accessToken: string };
  user: { id: string };
}

interface SettingsBody {
  timezone: string;
  version: number;
}

interface ErrorBody {
  error: {
    code: string;
    details: { fields?: Array<{ field: string; message: string }> };
  };
}

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

/**
 * The zone a learner's day is counted in (#452): checked against what
 * PostgreSQL knows when it comes in, movable by the client, and never a
 * reason for a request to fail once it is stored.
 */
describe("the learner's time zone (integration)", () => {
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
    `country_flags_time_zone_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;

  function signIn(
    subject: string,
    timezone: string,
  ): Promise<request.Response> {
    return app
      .get(TestProviderTokenSigner)
      .signGoogle({ subject, email: `${subject}@example.test` })
      .then((idToken) =>
        request(httpServer)
          .post("/v1/auth/google")
          .send({
            idToken,
            device: {
              clientGeneratedId: `time-zone-device-${subject}`,
              platform: "IOS",
              appVersion: "1.0.0",
              locale: "en",
              timezone,
            },
          }),
      );
  }

  async function settingsOf(accessToken: string): Promise<SettingsBody> {
    const response = await request(httpServer)
      .get("/v1/me/settings")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    return bodyOf<SettingsBody>(response);
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for time zone integration tests",
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
        `Time zone test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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
    await importTestContent(database);
    await importTestStudySeed(database);
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

  describe("at registration", () => {
    it("gives a new account the device's zone, in PostgreSQL's spelling", async () => {
      const response = await signIn("time-zone-known", "europe/berlin");
      expect(response.status).toBe(200);
      const account = bodyOf<AuthBody>(response);

      await expect(
        settingsOf(account.tokens.accessToken),
      ).resolves.toMatchObject({ timezone: "Europe/Berlin" });
    });

    // It used to be stored as sent, and every rebuild of the learner's
    // progress failed on it.
    it("gives a new account UTC when PostgreSQL does not know the device's zone", async () => {
      const response = await signIn("time-zone-unknown", "Mars/Olympus_Mons");
      expect(response.status).toBe(200);
      const account = bodyOf<AuthBody>(response);

      await expect(
        settingsOf(account.tokens.accessToken),
      ).resolves.toMatchObject({ timezone: "UTC" });
      const device = await database.device.findFirstOrThrow({
        where: { userId: account.user.id },
        select: { timezone: true },
      });
      expect(device.timezone).toBe("Mars/Olympus_Mons");
      await request(httpServer)
        .get("/v1/me/progress")
        .set("Authorization", `Bearer ${account.tokens.accessToken}`)
        .expect(200);
    });

    it("refuses a device zone that is not shaped like a zone name", async () => {
      const response = await signIn("time-zone-offset", "+05:30");

      expect(response.status).toBe(422);
      expect(bodyOf<ErrorBody>(response).error).toMatchObject({
        code: "VALIDATION_FAILED",
        details: { fields: [{ field: "device.timezone" }] },
      });
    });
  });

  describe("in settings", () => {
    it("moves the learner's day to a zone PostgreSQL knows", async () => {
      const account = bodyOf<AuthBody>(
        await signIn("time-zone-mover", "Europe/Moscow"),
      );
      const token = account.tokens.accessToken;
      const before = await settingsOf(token);

      const moved = await request(httpServer)
        .patch("/v1/me/settings")
        .set("Authorization", `Bearer ${token}`)
        .set("If-Match", `W/"${before.version}"`)
        .send({ timezone: "america/new_york" })
        .expect(200);

      expect(bodyOf<SettingsBody>(moved)).toMatchObject({
        timezone: "America/New_York",
        version: before.version + 1,
      });
    });

    // Intl takes an offset; PostgreSQL would read it with the sign inverted.
    it("refuses a zone PostgreSQL does not list and keeps the stored one", async () => {
      const account = bodyOf<AuthBody>(
        await signIn("time-zone-offset-settings", "Europe/Moscow"),
      );
      const token = account.tokens.accessToken;
      const before = await settingsOf(token);

      const refused = await request(httpServer)
        .patch("/v1/me/settings")
        .set("Authorization", `Bearer ${token}`)
        .set("If-Match", `W/"${before.version}"`)
        .send({ timezone: "+05:30" })
        .expect(422);

      expect(bodyOf<ErrorBody>(refused).error).toMatchObject({
        code: "VALIDATION_FAILED",
        details: { fields: [{ field: "timezone" }] },
      });
      await expect(settingsOf(token)).resolves.toMatchObject({
        timezone: "Europe/Moscow",
        version: before.version,
      });
    });
  });

  describe("once stored", () => {
    // A zone written before this validation existed, or by hand: the learner's
    // day falls back to UTC instead of every progress read answering 500.
    it("does not fail progress or a new session when PostgreSQL does not know it", async () => {
      await database.userSettings.upsert({
        where: { userId: TEST_STUDY_USER_ID },
        create: { userId: TEST_STUDY_USER_ID, timezone: "Mars/Olympus_Mons" },
        update: { timezone: "Mars/Olympus_Mons" },
      });
      const token = app.get(TestJwtSigner).sign(TEST_STUDY_USER_ID);

      for (const path of [
        "/v1/me/progress",
        "/v1/me/due-summary",
        "/v1/me/achievements",
      ]) {
        await request(httpServer)
          .get(path)
          .set("Authorization", `Bearer ${token}`)
          .expect(200);
      }
      await request(httpServer)
        .post("/v1/study-sessions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          id: "9c000000-0000-4000-8000-000000000001",
          deckId: "70000000-0000-4000-8000-000000000001",
          requestedUniqueCount: 5,
          mode: "SELF_RATED",
          locale: "en",
          selectionOrigin: "SERVER",
        })
        .expect(201);

      const [unknownZone, utc] = await database.$transaction(
        async (transaction) => [
          await reviewedTodayCount(
            transaction,
            TEST_STUDY_USER_ID,
            "Mars/Olympus_Mons",
          ),
          await reviewedTodayCount(transaction, TEST_STUDY_USER_ID, "UTC"),
        ],
      );
      expect(unknownZone).toBe(utc);
    });
  });
});
