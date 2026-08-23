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
import { TestProviderTokenSigner } from "../src/modules/auth/testing/test-provider-token-signer";
import { bodyOf } from "./response-body";

interface AdminUserBody {
  id: string;
  email: string;
  role: string;
  status: string;
}

interface AdminUserListBody {
  items: AdminUserBody[];
  total: number;
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

describe("Admin RBAC and access management (integration)", () => {
  jest.setTimeout(120_000);

  const baseUrl = process.env.DATABASE_URL;
  const originalEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    ...originalAdminEnvironment,
  };
  const databaseName =
    `country_flags_admin_access_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let signer: TestProviderTokenSigner;

  // One session per role, established once: the whole matrix reuses them.
  const cookies = new Map<AdminRole, string>();
  const userIds = new Map<AdminRole, string>();

  const ACCOUNTS: Array<{ role: AdminRole; subject: string; email: string }> = [
    {
      role: AdminRole.ADMIN,
      subject: "access-admin",
      email: "root@country-flags.test",
    },
    {
      role: AdminRole.PUBLISHER,
      subject: "access-publisher",
      email: "publisher@country-flags.test",
    },
    {
      role: AdminRole.EDITOR,
      subject: "access-editor",
      email: "editor2@country-flags.test",
    },
    {
      role: AdminRole.VIEWER,
      subject: "access-viewer",
      email: "viewer@country-flags.test",
    },
  ];

  async function login(
    subject: string,
    email: string,
  ): Promise<request.Response> {
    const idToken = await signer.signGoogle({ subject, email });
    return request(httpServer)
      .post("/v1/admin/auth/google")
      .set("Origin", TRUSTED_ORIGIN)
      .send({ idToken });
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for admin access integration tests",
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
        `Admin access test migration failed:\n${migration.stdout}\n${migration.stderr}`,
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

    // Bootstrap all four accounts as VIEWER, then set the intended roles
    // directly: role management via the API is exactly what this suite is
    // about to prove, so the fixtures cannot rely on it.
    for (const account of ACCOUNTS) {
      const response = await login(account.subject, account.email);
      if (response.status !== 200) {
        throw new Error(`Fixture login failed for ${account.email}`);
      }
      const body = bodyOf<AdminUserBody>(response);
      userIds.set(account.role, body.id);
      if (account.role !== AdminRole.VIEWER) {
        await database.adminUser.update({
          where: { id: body.id },
          data: { role: account.role },
        });
      }
      cookies.set(account.role, sessionCookieOf(response));
    }
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

  it("denies the whole roster surface to every role below ADMIN", async () => {
    for (const role of [
      AdminRole.VIEWER,
      AdminRole.EDITOR,
      AdminRole.PUBLISHER,
    ]) {
      const cookie = cookies.get(role)!;
      const targetId = userIds.get(AdminRole.VIEWER)!;

      const list = await request(httpServer)
        .get("/v1/admin/users")
        .set("Cookie", cookie);
      expect(list.status).toBe(403);
      expect(bodyOf<ErrorBody>(list).error.code).toBe("ADMIN_ROLE_FORBIDDEN");

      const one = await request(httpServer)
        .get(`/v1/admin/users/${targetId}`)
        .set("Cookie", cookie);
      expect(one.status).toBe(403);

      const patch = await request(httpServer)
        .patch(`/v1/admin/users/${targetId}`)
        .set("Cookie", cookie)
        .set("Origin", TRUSTED_ORIGIN)
        .send({ role: "ADMIN" });
      expect(patch.status).toBe(403);
      expect(bodyOf<ErrorBody>(patch).error.code).toBe("ADMIN_ROLE_FORBIDDEN");
    }
  });

  it("serves the roster to an ADMIN with offset/limit and total", async () => {
    const cookie = cookies.get(AdminRole.ADMIN)!;
    const list = await request(httpServer)
      .get("/v1/admin/users")
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    const body = bodyOf<AdminUserListBody>(list);
    expect(body.total).toBe(4);
    expect(body.items).toHaveLength(4);

    const page = await request(httpServer)
      .get("/v1/admin/users?offset=2&limit=2")
      .set("Cookie", cookie);
    const pageBody = bodyOf<AdminUserListBody>(page);
    expect(pageBody.total).toBe(4);
    expect(pageBody.items).toHaveLength(2);
    expect(pageBody.items.map((item) => item.email)).toEqual(
      body.items.slice(2).map((item) => item.email),
    );

    const one = await request(httpServer)
      .get(`/v1/admin/users/${userIds.get(AdminRole.VIEWER)!}`)
      .set("Cookie", cookie);
    expect(one.status).toBe(200);
    expect(bodyOf<AdminUserBody>(one).email).toBe("viewer@country-flags.test");
  });

  it("forbids an ADMIN from changing their own role or status", async () => {
    const cookie = cookies.get(AdminRole.ADMIN)!;
    const selfId = userIds.get(AdminRole.ADMIN)!;
    for (const payload of [{ role: "VIEWER" }, { status: "DISABLED" }]) {
      const response = await request(httpServer)
        .patch(`/v1/admin/users/${selfId}`)
        .set("Cookie", cookie)
        .set("Origin", TRUSTED_ORIGIN)
        .send(payload);
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe(
        "ADMIN_SELF_CHANGE_FORBIDDEN",
      );
    }
  });

  it("revokes the target's sessions when the role changes, and audits it", async () => {
    const adminCookie = cookies.get(AdminRole.ADMIN)!;
    const editorId = userIds.get(AdminRole.EDITOR)!;
    const editorCookie = cookies.get(AdminRole.EDITOR)!;

    const patch = await request(httpServer)
      .patch(`/v1/admin/users/${editorId}`)
      .set("Cookie", adminCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ role: "PUBLISHER" });
    expect(patch.status).toBe(200);
    expect(bodyOf<AdminUserBody>(patch).role).toBe("PUBLISHER");

    const me = await request(httpServer)
      .get("/v1/admin/me")
      .set("Cookie", editorCookie);
    expect(me.status).toBe(401);

    const audit = await database.adminAuditEvent.findMany({
      where: { action: "admin.user.role_changed", targetId: editorId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorAdminUserId).toBe(userIds.get(AdminRole.ADMIN));
    expect(audit[0]?.metadata).toEqual({
      before: "EDITOR",
      after: "PUBLISHER",
    });
  });

  it("disables an admin, cutting sessions and future logins", async () => {
    const adminCookie = cookies.get(AdminRole.ADMIN)!;
    const viewerId = userIds.get(AdminRole.VIEWER)!;
    const viewerCookie = cookies.get(AdminRole.VIEWER)!;

    const patch = await request(httpServer)
      .patch(`/v1/admin/users/${viewerId}`)
      .set("Cookie", adminCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ status: "DISABLED" });
    expect(patch.status).toBe(200);

    const me = await request(httpServer)
      .get("/v1/admin/me")
      .set("Cookie", viewerCookie);
    expect(me.status).toBe(401);

    const relogin = await login("access-viewer", "viewer@country-flags.test");
    expect(relogin.status).toBe(403);

    const audit = await database.adminAuditEvent.count({
      where: { action: "admin.user.status_changed", targetId: viewerId },
    });
    expect(audit).toBe(1);
  });

  it("treats a no-op update as a no-op: sessions stay, no audit row", async () => {
    const adminCookie = cookies.get(AdminRole.ADMIN)!;
    const publisherId = userIds.get(AdminRole.PUBLISHER)!;
    const publisherCookie = cookies.get(AdminRole.PUBLISHER)!;

    const patch = await request(httpServer)
      .patch(`/v1/admin/users/${publisherId}`)
      .set("Cookie", adminCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ role: "PUBLISHER" });
    expect(patch.status).toBe(200);

    const me = await request(httpServer)
      .get("/v1/admin/me")
      .set("Cookie", publisherCookie);
    expect(me.status).toBe(200);

    // The bootstrap grant already wrote one row for this target; a no-op
    // update must not add role or status changes on top of it.
    const audit = await database.adminAuditEvent.count({
      where: {
        targetId: publisherId,
        action: {
          in: ["admin.user.role_changed", "admin.user.status_changed"],
        },
      },
    });
    expect(audit).toBe(0);
  });

  it("rejects malformed updates and untrusted origins", async () => {
    const adminCookie = cookies.get(AdminRole.ADMIN)!;
    const publisherId = userIds.get(AdminRole.PUBLISHER)!;

    const noOrigin = await request(httpServer)
      .patch(`/v1/admin/users/${publisherId}`)
      .set("Cookie", adminCookie)
      .send({ role: "VIEWER" });
    expect(noOrigin.status).toBe(403);
    expect(bodyOf<ErrorBody>(noOrigin).error.code).toBe("ORIGIN_NOT_ALLOWED");

    const empty = await request(httpServer)
      .patch(`/v1/admin/users/${publisherId}`)
      .set("Cookie", adminCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({});
    expect(empty.status).toBe(422);

    const unknownRole = await request(httpServer)
      .patch(`/v1/admin/users/${publisherId}`)
      .set("Cookie", adminCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ role: "GOD" });
    expect(unknownRole.status).toBe(422);

    const missing = await request(httpServer)
      .patch("/v1/admin/users/8f1f9f76-1f0a-4a2e-9a5e-2b8f4f1c9d10")
      .set("Cookie", adminCookie)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ role: "VIEWER" });
    expect(missing.status).toBe(404);
  });

  it("records the bootstrap grant in the audit trail", async () => {
    const bootstrapped = await database.adminAuditEvent.count({
      where: { action: "admin.user.bootstrapped" },
    });
    expect(bootstrapped).toBe(4);
  });
});
