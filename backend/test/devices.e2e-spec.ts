import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { AnswerMode, PrismaClient, ReviewRating } from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { TestProviderTokenSigner } from "../src/modules/auth/testing/test-provider-token-signer";
import { importTestContent } from "../src/modules/content/import/test-content-importer";
import { importTestStudySeed } from "../src/modules/study-sessions/import/test-study-seed-importer";
import { bodyOf } from "./response-body";

interface AuthBody {
  tokens: { accessToken: string; refreshToken: string };
  user: { id: string };
}

interface DeviceListBody {
  items: Array<{ id: string; current: boolean }>;
}

interface SessionBody {
  cards: Array<{ learningCard: { id: string } }>;
}

interface ReviewBatchBody {
  results: Array<{ status: string; rejectionCode: string | null }>;
}

interface ErrorBody {
  error: { code: string };
}

const DECK_ID = "70000000-0000-4000-8000-000000000001";
const PHONE = "devices-e2e-phone-0000001";
const TABLET = "devices-e2e-tablet-000001";

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
    locale: "en",
    timezone: "Europe/Berlin",
  };
}

describe("removing a device with review history (integration)", () => {
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
    `country_flags_devices_${process.pid}_${Date.now()}`.toLowerCase();
  let testDatabaseUrl: string;
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let signer: TestProviderTokenSigner;

  async function login(clientGeneratedId: string): Promise<AuthBody> {
    const idToken = await signer.signGoogle({
      subject: "devices-e2e-google-subject",
      email: "devices@example.test",
    });
    const response = await request(httpServer)
      .post("/v1/auth/google")
      .send({ idToken, device: device(clientGeneratedId) })
      .expect(200);
    return bodyOf(response);
  }

  async function listDevices(accessToken: string): Promise<DeviceListBody> {
    const response = await request(httpServer)
      .get("/v1/me/devices")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    return bodyOf(response);
  }

  async function currentDeviceId(accessToken: string): Promise<string> {
    const current = (await listDevices(accessToken)).items.find(
      (item) => item.current,
    );
    if (current === undefined) {
      throw new Error("The signed-in device is missing from the list");
    }
    return current.id;
  }

  async function sendReview(
    accessToken: string,
    event: Record<string, unknown>,
  ): Promise<ReviewBatchBody> {
    const response = await request(httpServer)
      .post("/v1/reviews/batch")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ payloadVersion: 1, events: [event] })
      .expect(200);
    return bodyOf(response);
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error("DATABASE_URL is required for device integration tests");
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
        `Device test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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

  it("revokes the sessions of a device that answered a card and keeps its history", async () => {
    const phone = await login(PHONE);
    const tablet = await login(TABLET);
    const phoneDeviceId = await currentDeviceId(phone.tokens.accessToken);

    // The phone answers a card, so an immutable review event references it.
    const sessionId = randomUUID();
    const session = await request(httpServer)
      .post("/v1/study-sessions")
      .set("Authorization", `Bearer ${phone.tokens.accessToken}`)
      .send({
        id: sessionId,
        deckId: DECK_ID,
        requestedUniqueCount: 5,
        mode: AnswerMode.SELF_RATED,
        locale: "en",
        selectionOrigin: "SERVER",
      })
      .expect(201);
    const [answered, unanswered] = bodyOf<SessionBody>(session).cards;
    if (answered === undefined || unanswered === undefined) {
      throw new Error("The study session holds fewer than two cards");
    }
    const answeredAt = new Date().toISOString();
    const review = (event: {
      learningCardId: string;
      clientSequence: number;
    }): Record<string, unknown> => ({
      id: randomUUID(),
      sessionId,
      deviceId: phoneDeviceId,
      answerMode: AnswerMode.SELF_RATED,
      rating: ReviewRating.GOOD,
      responseTimeMs: 3100,
      clientOccurredAt: answeredAt,
      estimatedServerOccurredAt: answeredAt,
      baseStateVersion: 0,
      ...event,
    });
    const accepted = await sendReview(
      phone.tokens.accessToken,
      review({ learningCardId: answered.learningCard.id, clientSequence: 1 }),
    );
    expect(accepted.results[0]?.status).toBe("ACCEPTED");
    const historyBefore = await database.reviewEvent.findMany({
      where: { deviceId: phoneDeviceId },
      orderBy: { id: "asc" },
    });
    expect(historyBefore).toHaveLength(1);

    // Removed from the other device, the way a lost phone is.
    await request(httpServer)
      .delete(`/v1/me/devices/${phoneDeviceId}`)
      .set("Authorization", `Bearer ${tablet.tokens.accessToken}`)
      .expect(204);

    await request(httpServer)
      .get("/v1/me")
      .set("Authorization", `Bearer ${phone.tokens.accessToken}`)
      .expect(401);
    const refresh = await request(httpServer)
      .post("/v1/auth/refresh")
      .send({ refreshToken: phone.tokens.refreshToken })
      .expect(401);
    expect(bodyOf<ErrorBody>(refresh).error.code).toBe("REFRESH_TOKEN_INVALID");
    await expect(
      database.refreshSession.count({
        where: { deviceId: phoneDeviceId, revokedAt: null },
      }),
    ).resolves.toBe(0);

    // The history is untouched and still names the device.
    await expect(
      database.reviewEvent.findMany({
        where: { deviceId: phoneDeviceId },
        orderBy: { id: "asc" },
      }),
    ).resolves.toEqual(historyBefore);
    const removed = await database.device.findUniqueOrThrow({
      where: { id: phoneDeviceId },
      select: { deletedAt: true, pushTokenEncrypted: true },
    });
    expect(removed.deletedAt).toBeInstanceOf(Date);
    expect(removed.pushTokenEncrypted).toBeNull();

    // Gone from the list, and removing it again is like removing a stranger.
    const remaining = await listDevices(tablet.tokens.accessToken);
    expect(remaining.items.map(({ id }) => id)).not.toContain(phoneDeviceId);
    expect(remaining.items).toHaveLength(1);
    const again = await request(httpServer)
      .delete(`/v1/me/devices/${phoneDeviceId}`)
      .set("Authorization", `Bearer ${tablet.tokens.accessToken}`)
      .expect(404);
    expect(bodyOf<ErrorBody>(again).error.code).toBe("DEVICE_NOT_FOUND");

    // A removed device takes no new answers, whoever sends them.
    const rejected = await sendReview(
      tablet.tokens.accessToken,
      review({ learningCardId: unanswered.learningCard.id, clientSequence: 2 }),
    );
    expect(rejected.results[0]).toMatchObject({
      status: "REJECTED",
      rejectionCode: "DEVICE_NOT_FOUND",
    });
  });

  it("brings a removed device back under the same identifier on a new sign-in", async () => {
    const removedDevice = await database.device.findFirstOrThrow({
      where: { clientGeneratedId: PHONE },
      select: { id: true, deletedAt: true },
    });
    expect(removedDevice.deletedAt).not.toBeNull();

    const phone = await login(PHONE);

    await expect(currentDeviceId(phone.tokens.accessToken)).resolves.toBe(
      removedDevice.id,
    );
    await expect(
      database.device.findUniqueOrThrow({
        where: { id: removedDevice.id },
        select: { deletedAt: true },
      }),
    ).resolves.toEqual({ deletedAt: null });
    await expect(
      database.reviewEvent.count({ where: { deviceId: removedDevice.id } }),
    ).resolves.toBe(1);
  });
});
