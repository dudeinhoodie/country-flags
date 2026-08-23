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
import { AdminUserStatus, PrismaClient } from "@prisma/client";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { TestProviderTokenSigner } from "../src/modules/auth/testing/test-provider-token-signer";
import { bodyOf } from "./response-body";

interface AdminUserBody {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  createdAt: string;
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

function sessionCookieOf(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const cookies: string[] = Array.isArray(header)
    ? header
    : typeof header === "string"
      ? [header]
      : [];
  const sessionCookie = cookies.find((cookie) =>
    cookie.startsWith("cf_admin_session="),
  );
  if (sessionCookie === undefined) {
    throw new Error("Admin session cookie is missing from the response");
  }
  return sessionCookie;
}

describe("Admin identity, sessions and allowlist (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    ...originalAdminEnvironment,
  };
  const databaseName =
    `country_flags_admin_auth_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let signer: TestProviderTokenSigner;

  async function login(
    subject: string,
    email: string,
    origin: string | null = TRUSTED_ORIGIN,
  ): Promise<request.Response> {
    const idToken = await signer.signGoogle({ subject, email });
    let post = request(httpServer).post("/v1/admin/auth/google");
    if (origin !== null) {
      post = post.set("Origin", origin);
    }
    return post.send({ idToken });
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for admin auth integration tests",
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
        `Admin auth test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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

  it("rejects a login mutation without a trusted origin", async () => {
    const missing = await login(
      "admin-subject-origin",
      "editor@example.test",
      null,
    );
    expect(missing.status).toBe(403);
    expect(bodyOf<ErrorBody>(missing).error.code).toBe("ORIGIN_NOT_ALLOWED");

    const foreign = await login(
      "admin-subject-origin",
      "editor@example.test",
      "https://evil.example",
    );
    expect(foreign.status).toBe(403);
    expect(bodyOf<ErrorBody>(foreign).error.code).toBe("ORIGIN_NOT_ALLOWED");
    expect(foreign.headers["set-cookie"]).toBeUndefined();
  });

  it("denies a verified Google account outside the allowlist", async () => {
    const response = await login(
      "admin-subject-outsider",
      "outsider@nowhere.test",
    );
    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe("ADMIN_ACCESS_DENIED");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(
      await database.adminUser.findUnique({
        where: { email: "outsider@nowhere.test" },
      }),
    ).toBeNull();
  });

  it("creates a VIEWER admin on the first allowlisted login", async () => {
    const response = await login("admin-subject-editor", "editor@example.test");
    expect(response.status).toBe(200);
    const body = bodyOf<AdminUserBody>(response);
    expect(body.email).toBe("editor@example.test");
    expect(body.role).toBe("VIEWER");
    expect(body.status).toBe("ACTIVE");

    const cookie = sessionCookieOf(response);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");

    const stored = await database.adminUser.findUnique({
      where: { email: "editor@example.test" },
      include: { identities: true },
    });
    expect(stored?.role).toBe("VIEWER");
    expect(stored?.identities).toHaveLength(1);
    expect(stored?.identities[0]?.providerSubject).toBe("admin-subject-editor");
  });

  it("reuses the admin user and rotates the session on a repeat login", async () => {
    const response = await login("admin-subject-editor", "editor@example.test");
    expect(response.status).toBe(200);
    const users = await database.adminUser.findMany({
      where: { email: "editor@example.test" },
    });
    expect(users).toHaveLength(1);
    const sessions = await database.adminSession.count({
      where: { adminUser: { email: "editor@example.test" } },
    });
    expect(sessions).toBe(2);
  });

  it("serves /me for a session cookie and rejects requests without one", async () => {
    const loginResponse = await login(
      "admin-subject-domain",
      "someone@country-flags.test",
    );
    expect(loginResponse.status).toBe(200);
    const cookie = sessionCookieOf(loginResponse);

    const me = await request(httpServer)
      .get("/v1/admin/me")
      .set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(bodyOf<AdminUserBody>(me).email).toBe("someone@country-flags.test");

    const anonymous = await request(httpServer).get("/v1/admin/me");
    expect(anonymous.status).toBe(401);

    const forged = await request(httpServer)
      .get("/v1/admin/me")
      .set("Cookie", "cf_admin_session=forged-token-value");
    expect(forged.status).toBe(401);
  });

  it("cuts off a disabled admin immediately, active sessions included", async () => {
    const loginResponse = await login(
      "admin-subject-disabled",
      "victim@country-flags.test",
    );
    expect(loginResponse.status).toBe(200);
    const cookie = sessionCookieOf(loginResponse);

    await database.adminUser.update({
      where: { email: "victim@country-flags.test" },
      data: { status: AdminUserStatus.DISABLED },
    });

    const me = await request(httpServer)
      .get("/v1/admin/me")
      .set("Cookie", cookie);
    expect(me.status).toBe(401);

    const relogin = await login(
      "admin-subject-disabled",
      "victim@country-flags.test",
    );
    expect(relogin.status).toBe(403);
    expect(bodyOf<ErrorBody>(relogin).error.code).toBe("ADMIN_ACCESS_DENIED");
  });

  it("revokes the session on logout and requires a trusted origin for it", async () => {
    const loginResponse = await login(
      "admin-subject-editor",
      "editor@example.test",
    );
    expect(loginResponse.status).toBe(200);
    const cookie = sessionCookieOf(loginResponse);

    const foreignLogout = await request(httpServer)
      .post("/v1/admin/auth/logout")
      .set("Cookie", cookie)
      .set("Origin", "https://evil.example");
    expect(foreignLogout.status).toBe(403);

    const logout = await request(httpServer)
      .post("/v1/admin/auth/logout")
      .set("Cookie", cookie)
      .set("Origin", TRUSTED_ORIGIN);
    expect(logout.status).toBe(204);
    const cleared = sessionCookieOf(logout);
    expect(cleared).toContain("cf_admin_session=;");

    const me = await request(httpServer)
      .get("/v1/admin/me")
      .set("Cookie", cookie);
    expect(me.status).toBe(401);
  });

  it("rejects a malformed provider token", async () => {
    const response = await request(httpServer)
      .post("/v1/admin/auth/google")
      .set("Origin", TRUSTED_ORIGIN)
      .send({ idToken: "not-a-real-google-token" });
    expect(response.status).toBe(401);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });
});
