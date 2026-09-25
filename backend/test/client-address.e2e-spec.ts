// Must be the first import: it fixes the proxy topology before app.module.ts
// snapshots process.env through ConfigModule.forRoot.
import {
  originalClientAddressEnvironment,
  TRUSTED_ORIGIN,
} from "./client-address.environment";

import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { configureTrustedProxies } from "../src/common/http/client-address";
import { TestProviderTokenSigner } from "../src/modules/auth/testing/test-provider-token-signer";
import { bodyOf } from "./response-body";

interface AuthBody {
  tokens: { accessToken: string; refreshToken: string };
}

interface TokenPairBody {
  refreshToken: string;
}

interface ErrorBody {
  error: { code: string };
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
    locale: "en",
    timezone: "Europe/Berlin",
  };
}

describe("Rate limits keyed on the client behind the proxy (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    ...originalClientAddressEnvironment,
  };
  const databaseName =
    `country_flags_client_address_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let app: INestApplication;
  let httpServer: Server;
  let signer: TestProviderTokenSigner;

  function rejectedGoogleSignIn(forwardedFor: string): request.Test {
    return request(httpServer)
      .post("/v1/auth/google")
      .set("X-Forwarded-For", forwardedFor)
      .send({
        idToken: "invalid-provider-token-that-is-long-enough",
        device: device("client-address-device-0001"),
      });
  }

  function rejectedConsoleSignIn(forwardedFor: string): request.Test {
    return request(httpServer)
      .post("/v1/admin/auth/google")
      .set("Origin", TRUSTED_ORIGIN)
      .set("X-Forwarded-For", forwardedFor)
      .send({ idToken: "invalid-provider-token-that-is-long-enough" });
  }

  async function exhaust(
    send: () => request.Test,
    allowed: number,
    status: number,
  ): Promise<void> {
    for (let attempt = 0; attempt < allowed; attempt += 1) {
      const response = await send();
      expect(response.status).toBe(status);
    }
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(bodyOf<ErrorBody>(limited).error.code).toBe("RATE_LIMIT_EXCEEDED");
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for client address integration tests",
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
          DIRECT_DATABASE_URL: testDatabaseUrl,
        },
      },
    );
    if (migration.status !== 0) {
      throw new Error(
        `Client address test migration failed:\n${migration.stdout}\n${migration.stderr}`,
      );
    }

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.NODE_ENV = "test";
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const expressApp =
      moduleRef.createNestApplication<NestExpressApplication>();
    expressApp.setGlobalPrefix("v1");
    // The same call main.ts makes, with the hop count the environment names.
    configureTrustedProxies(expressApp, 1);
    await expressApp.init();
    app = expressApp;
    httpServer = app.getHttpServer() as Server;
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

  it("gives two forwarded clients separate sign-in buckets", async () => {
    await exhaust(() => rejectedGoogleSignIn("198.51.100.10"), 10, 401);

    const other = await rejectedGoogleSignIn("198.51.100.11");
    expect(other.status).toBe(401);
  });

  it("keys on the address the front end appended, not on the caller's own entries", async () => {
    await exhaust(() => rejectedGoogleSignIn("198.51.100.20"), 10, 401);

    // The front end appends the real peer on the right; anything to its left
    // came from the caller and does not open a new bucket.
    const prefixed = await rejectedGoogleSignIn("203.0.113.1, 198.51.100.20");
    expect(prefixed.status).toBe(429);
  });

  it("limits refreshes per sign-in wherever they come from", async () => {
    const idToken = await signer.signGoogle({
      subject: "client-address-refresh-subject",
      email: "refresh@example.test",
    });
    const login = await request(httpServer)
      .post("/v1/auth/google")
      .set("X-Forwarded-For", "198.51.100.30")
      .send({ idToken, device: device("client-address-device-0002") })
      .expect(200);
    let refreshToken = bodyOf<AuthBody>(login).tokens.refreshToken;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const rotated = await request(httpServer)
        .post("/v1/auth/refresh")
        .set("X-Forwarded-For", `198.51.100.${100 + attempt}`)
        .send({ refreshToken })
        .expect(200);
      refreshToken = bodyOf<TokenPairBody>(rotated).refreshToken;
    }

    const limited = await request(httpServer)
      .post("/v1/auth/refresh")
      .set("X-Forwarded-For", "198.51.100.200")
      .send({ refreshToken })
      .expect(429);
    expect(bodyOf<ErrorBody>(limited).error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("gives two console users behind the console proxy separate buckets", async () => {
    // Console user, then the console's egress appended by the API front end.
    await exhaust(
      () => rejectedConsoleSignIn("198.51.100.40, 192.0.2.1"),
      10,
      401,
    );

    const other = await rejectedConsoleSignIn("198.51.100.41, 192.0.2.1");
    expect(other.status).toBe(401);
  });

  it("bounds console sign-in per edge address whatever the forwarded client", async () => {
    // A caller that reaches the API directly controls the entries left of
    // the one the front end appends; the edge bucket still counts them all.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await rejectedConsoleSignIn(
        `203.0.113.${attempt}, 192.0.2.99`,
      );
      expect(response.status).toBe(401);
    }
    const limited = await rejectedConsoleSignIn("203.0.113.250, 192.0.2.99");
    expect(limited.status).toBe(429);
  });
});
