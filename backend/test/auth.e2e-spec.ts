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
import { TestProviderTokenSigner } from "../src/modules/auth/testing/test-provider-token-signer";
import { bodyOf } from "./response-body";

interface AuthBody {
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: string;
  };
  user: { id: string };
}

interface TokenPairBody {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
}

interface IdentityListBody {
  items: Array<{ id: string; provider: "APPLE" | "GOOGLE" }>;
}

interface ErrorBody {
  error: {
    code: string;
    requestId: string;
    details: Record<string, unknown>;
  };
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

describe("Apple/Google authentication and backend sessions (integration)", () => {
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
    `country_flags_auth_${process.pid}_${Date.now()}`.toLowerCase();
  const rawNonce = "TEST_ONLY_auth_e2e_nonce_000001";
  let testDatabaseUrl: string;
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let signer: TestProviderTokenSigner;
  let googleAccount: AuthBody;
  let appleAccount: AuthBody;

  async function googleLogin(
    subject: string,
    email: string,
    deviceId: string,
  ): Promise<AuthBody> {
    const idToken = await signer.signGoogle({ subject, email });
    const response = await request(httpServer)
      .post("/v1/auth/google")
      .send({ idToken, device: device(deviceId) })
      .expect(200);
    return bodyOf(response);
  }

  async function appleLogin(
    subject: string,
    email: string,
    deviceId: string,
  ): Promise<AuthBody> {
    const identityToken = await signer.signApple({
      subject,
      email,
      rawNonce,
      isPrivateEmail: true,
    });
    const response = await request(httpServer)
      .post("/v1/auth/apple")
      .send({
        identityToken,
        authorizationCode: "TEST_ONLY_apple_authorization_code",
        rawNonce,
        device: device(deviceId),
      })
      .expect(200);
    return bodyOf(response);
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error("DATABASE_URL is required for auth integration tests");
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
        `Auth test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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

  it("never merges Apple and Google identities by email", async () => {
    const sharedRelayEmail = "shared@privaterelay.appleid.com";
    googleAccount = await googleLogin(
      "google-existing-subject",
      sharedRelayEmail,
      "auth-device-google-000001",
    );
    appleAccount = await appleLogin(
      "apple-existing-subject",
      sharedRelayEmail,
      "auth-device-apple-0000001",
    );

    expect(googleAccount.user.id).not.toBe(appleAccount.user.id);
    await expect(database.user.count()).resolves.toBe(2);
    await expect(database.authIdentity.count()).resolves.toBe(2);
    const appleIdentity = await database.authIdentity.findUniqueOrThrow({
      where: {
        provider_providerSubject: {
          provider: "APPLE",
          providerSubject: "apple-existing-subject",
        },
      },
    });
    expect(appleIdentity).toMatchObject({
      email: sharedRelayEmail,
      isPrivateEmail: true,
    });
  });

  it("rejects identity collisions and protects the last identity", async () => {
    const existingGoogleToken = await signer.signGoogle({
      subject: "google-existing-subject",
      email: "another-email@example.test",
    });
    const collision = await request(httpServer)
      .post("/v1/me/identities/google")
      .set("Authorization", `Bearer ${appleAccount.tokens.accessToken}`)
      .send({ idToken: existingGoogleToken })
      .expect(409);
    expect((collision.body as unknown as ErrorBody).error.code).toBe(
      "IDENTITY_ALREADY_LINKED",
    );

    const newGoogleToken = await signer.signGoogle({
      subject: "google-linked-to-apple",
    });
    await request(httpServer)
      .post("/v1/me/identities/google")
      .set("Authorization", `Bearer ${appleAccount.tokens.accessToken}`)
      .send({ idToken: newGoogleToken })
      .expect(201);
    const listed = await request(httpServer)
      .get("/v1/me/identities")
      .set("Authorization", `Bearer ${appleAccount.tokens.accessToken}`)
      .expect(200);
    expect(
      (listed.body as unknown as IdentityListBody).items.map(
        ({ provider }) => provider,
      ),
    ).toEqual(["APPLE", "GOOGLE"]);

    await request(httpServer)
      .delete("/v1/me/identities/GOOGLE")
      .set("Authorization", `Bearer ${appleAccount.tokens.accessToken}`)
      .expect(204);
    const lastIdentity = await request(httpServer)
      .delete("/v1/me/identities/APPLE")
      .set("Authorization", `Bearer ${appleAccount.tokens.accessToken}`)
      .expect(409);
    expect((lastIdentity.body as unknown as ErrorBody).error.code).toBe(
      "LAST_IDENTITY_CANNOT_BE_REMOVED",
    );
  });

  it("rotates refresh tokens and revokes the family on replay", async () => {
    const account = await googleLogin(
      "google-refresh-subject",
      "refresh@example.test",
      "auth-device-refresh-00001",
    );
    const rotated = await request(httpServer)
      .post("/v1/auth/refresh")
      .send({ refreshToken: account.tokens.refreshToken })
      .expect(200);
    const next = rotated.body as unknown as TokenPairBody;
    expect(next.refreshToken).not.toBe(account.tokens.refreshToken);

    const replay = await request(httpServer)
      .post("/v1/auth/refresh")
      .send({ refreshToken: account.tokens.refreshToken })
      .expect(401);
    expect((replay.body as unknown as ErrorBody).error.code).toBe(
      "REFRESH_TOKEN_REUSED",
    );
    await request(httpServer)
      .get("/v1/me/identities")
      .set("Authorization", `Bearer ${next.accessToken}`)
      .expect(401);
    await request(httpServer)
      .post("/v1/auth/refresh")
      .send({ refreshToken: next.refreshToken })
      .expect(401);
  });

  it("supports current-session and global logout", async () => {
    const first = await googleLogin(
      "google-logout-subject",
      "logout@example.test",
      "auth-device-logout-000001",
    );
    const second = await googleLogin(
      "google-logout-subject",
      "logout@example.test",
      "auth-device-logout-000002",
    );

    await request(httpServer)
      .post("/v1/auth/logout")
      .set("Authorization", `Bearer ${first.tokens.accessToken}`)
      .send({ refreshToken: first.tokens.refreshToken })
      .expect(204);
    await request(httpServer)
      .get("/v1/me/identities")
      .set("Authorization", `Bearer ${first.tokens.accessToken}`)
      .expect(401);
    await request(httpServer)
      .get("/v1/me/identities")
      .set("Authorization", `Bearer ${second.tokens.accessToken}`)
      .expect(200);

    await request(httpServer)
      .post("/v1/auth/logout-all")
      .set("Authorization", `Bearer ${second.tokens.accessToken}`)
      .expect(204);
    await request(httpServer)
      .get("/v1/me/identities")
      .set("Authorization", `Bearer ${second.tokens.accessToken}`)
      .expect(401);
  });

  it("rate limits repeated provider authentication attempts", async () => {
    let response: request.Response | undefined;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      response = await request(httpServer)
        .post("/v1/auth/google")
        .send({
          idToken: "invalid-provider-token-that-is-long-enough",
          device: device("auth-device-rate-limit-0001"),
        });
      if (response.status === 429) {
        break;
      }
      expect(response.status).toBe(401);
    }
    if (response === undefined) {
      throw new Error("Rate-limit response was not received");
    }
    expect(response.status).toBe(429);
    expect((response.body as unknown as ErrorBody).error.code).toBe(
      "RATE_LIMIT_EXCEEDED",
    );
    expect(response.headers["retry-after"]).toMatch(/^\d+$/);
  });
});
