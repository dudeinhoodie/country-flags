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
import {
  AppleTokenClient,
  type AppleTokenExchange,
  type AppleTokenRevocation,
} from "../src/modules/auth/apple/apple-token.client";
import { TestProviderTokenSigner } from "../src/modules/auth/testing/test-provider-token-signer";
import { bodyOf } from "./response-body";

interface AuthBody {
  tokens: { accessToken: string; refreshToken: string };
  user: { id: string };
}

const APPLE_CLIENT_ID = "com.countryflags.local";
const AUTHORIZATION_CODE = "TEST_ONLY_apple_authorization_code";

/**
 * Apple's token endpoints as the tests need them: every exchange hands out a
 * fresh refresh token, and every call is recorded. Nothing leaves the process.
 */
class FakeAppleTokenClient extends AppleTokenClient {
  isConfigured = true;
  nextExchange: AppleTokenExchange | null = null;
  nextRevocation: AppleTokenRevocation = { kind: "revoked" };
  readonly exchanges: Array<{ clientId: string; authorizationCode: string }> =
    [];
  readonly revocations: Array<{ clientId: string; refreshToken: string }> = [];
  private issued = 0;

  get configured(): boolean {
    return this.isConfigured;
  }

  exchangeAuthorizationCode(input: {
    clientId: string;
    authorizationCode: string;
  }): Promise<AppleTokenExchange> {
    this.exchanges.push(input);
    const answer = this.nextExchange;
    this.nextExchange = null;
    if (answer !== null) {
      return Promise.resolve(answer);
    }
    this.issued += 1;
    return Promise.resolve({
      kind: "exchanged",
      refreshToken: `TEST_ONLY_apple_refresh_${this.issued}`,
    });
  }

  revokeRefreshToken(input: {
    clientId: string;
    refreshToken: string;
  }): Promise<AppleTokenRevocation> {
    this.revocations.push(input);
    const answer = this.nextRevocation;
    this.nextRevocation = { kind: "revoked" };
    return Promise.resolve(answer);
  }

  reset(): void {
    this.isConfigured = true;
    this.nextExchange = null;
    this.nextRevocation = { kind: "revoked" };
    this.exchanges.length = 0;
    this.revocations.length = 0;
  }
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

describe("Sign in with Apple token exchange and revocation (integration)", () => {
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
    `country_flags_apple_tokens_${process.pid}_${Date.now()}`.toLowerCase();
  const rawNonce = "TEST_ONLY_apple_tokens_nonce_0001";
  const apple = new FakeAppleTokenClient();
  let admin: PrismaClient;
  let database: PrismaService;
  let app: INestApplication;
  let httpServer: Server;
  let signer: TestProviderTokenSigner;

  async function appleLogin(
    subject: string,
    deviceId: string,
  ): Promise<AuthBody> {
    const identityToken = await signer.signApple({ subject, rawNonce });
    const response = await request(httpServer)
      .post("/v1/auth/apple")
      .send({
        identityToken,
        authorizationCode: AUTHORIZATION_CODE,
        rawNonce,
        device: device(deviceId),
      })
      .expect(200);
    return bodyOf(response);
  }

  async function googleLogin(
    subject: string,
    deviceId: string,
  ): Promise<AuthBody> {
    const idToken = await signer.signGoogle({ subject });
    const response = await request(httpServer)
      .post("/v1/auth/google")
      .send({ idToken, device: device(deviceId) })
      .expect(200);
    return bodyOf(response);
  }

  async function deleteAccount(account: AuthBody): Promise<unknown> {
    await request(httpServer)
      .delete("/v1/me")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .expect(202);
    const audit = await database.auditEvent.findFirstOrThrow({
      where: { actorUserId: account.user.id, action: "ACCOUNT_DELETED" },
    });
    return audit.metadata;
  }

  function appleIdentity(subject: string): Promise<{
    providerTokenCiphertext: string | null;
    providerTokenClientId: string | null;
    providerTokenState: string | null;
  }> {
    return database.authIdentity.findUniqueOrThrow({
      where: {
        provider_providerSubject: {
          provider: "APPLE",
          providerSubject: subject,
        },
      },
      select: {
        providerTokenCiphertext: true,
        providerTokenClientId: true,
        providerTokenState: true,
      },
    });
  }

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error("DATABASE_URL is required for Apple token tests");
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
        `Apple token test migration failed:\n${migration.stdout}\n${migration.stderr}`,
      );
    }

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.NODE_ENV = "test";
    process.env.TEST_AUTH_ENABLED = "true";
    process.env.AUTH_PROVIDER_TEST_TOKENS_ENABLED = "true";
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AppleTokenClient)
      .useValue(apple)
      .compile();
    const expressApp =
      moduleRef.createNestApplication<NestExpressApplication>();
    expressApp.setGlobalPrefix("v1");
    await expressApp.init();
    app = expressApp;
    httpServer = app.getHttpServer() as Server;
    database = app.get(PrismaService);
    signer = app.get(TestProviderTokenSigner);
  });

  beforeEach(() => {
    apple.reset();
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

  it("exchanges the sign-in's code and revokes the token when the account is deleted", async () => {
    const account = await appleLogin(
      "apple-token-subject-01",
      "apple-token-device-0001",
    );

    expect(apple.exchanges).toEqual([
      { clientId: APPLE_CLIENT_ID, authorizationCode: AUTHORIZATION_CODE },
    ]);
    const stored = await appleIdentity("apple-token-subject-01");
    expect(stored).toMatchObject({
      providerTokenClientId: APPLE_CLIENT_ID,
      providerTokenState: "STORED",
    });
    // Encrypted at rest: the column holds a sealed value, never the token.
    expect(stored.providerTokenCiphertext).toMatch(/^v1\./);
    expect(stored.providerTokenCiphertext).not.toContain(
      "TEST_ONLY_apple_refresh",
    );
    const login = await database.auditEvent.findFirstOrThrow({
      where: { actorUserId: account.user.id, action: "AUTH_LOGIN_SUCCEEDED" },
    });
    expect(login.metadata).toMatchObject({ appleTokenExchange: "STORED" });

    const deletion = await deleteAccount(account);

    expect(apple.revocations).toEqual([
      { clientId: APPLE_CLIENT_ID, refreshToken: "TEST_ONLY_apple_refresh_1" },
    ]);
    expect(deletion).toMatchObject({
      identityProviders: ["APPLE"],
      providerCredentialRevocation: "revoked",
      providerCredentialRevocationFailure: null,
      appleTokenExchange: "STORED",
    });
    await expect(
      database.authIdentity.count({ where: { userId: account.user.id } }),
    ).resolves.toBe(0);
  });

  it("signs in when the exchange fails, keeping the token an earlier sign-in stored", async () => {
    const account = await appleLogin(
      "apple-token-subject-02",
      "apple-token-device-0002",
    );
    const first = await appleIdentity("apple-token-subject-02");

    apple.nextExchange = { kind: "failed", reason: "invalid_grant" };
    await appleLogin("apple-token-subject-02", "apple-token-device-0003");

    await expect(appleIdentity("apple-token-subject-02")).resolves.toEqual({
      providerTokenCiphertext: first.providerTokenCiphertext,
      providerTokenClientId: APPLE_CLIENT_ID,
      providerTokenState: "EXCHANGE_FAILED",
    });
    const deletion = await deleteAccount(account);
    expect(apple.revocations).toHaveLength(1);
    expect(deletion).toMatchObject({
      providerCredentialRevocation: "revoked",
      appleTokenExchange: "EXCHANGE_FAILED",
    });
  });

  it("deletes the account when Apple refuses the revocation, and says so", async () => {
    const account = await appleLogin(
      "apple-token-subject-03",
      "apple-token-device-0004",
    );
    apple.nextRevocation = { kind: "failed", reason: "unavailable" };

    const deletion = await deleteAccount(account);

    expect(deletion).toMatchObject({
      providerCredentialRevocation: "revocation_failed",
      providerCredentialRevocationFailure: "unavailable",
    });
    await expect(
      database.user.findUniqueOrThrow({ where: { id: account.user.id } }),
    ).resolves.toMatchObject({ status: "DELETED" });
  });

  it("records a missing Sign in with Apple key at sign-in and at deletion", async () => {
    apple.isConfigured = false;
    const account = await appleLogin(
      "apple-token-subject-04",
      "apple-token-device-0005",
    );

    expect(apple.exchanges).toHaveLength(0);
    await expect(appleIdentity("apple-token-subject-04")).resolves.toEqual({
      providerTokenCiphertext: null,
      providerTokenClientId: null,
      providerTokenState: "CREDENTIALS_NOT_CONFIGURED",
    });
    const deletion = await deleteAccount(account);
    expect(apple.revocations).toHaveLength(0);
    expect(deletion).toMatchObject({
      providerCredentialRevocation: "credentials_not_configured",
      appleTokenExchange: "CREDENTIALS_NOT_CONFIGURED",
    });
  });

  it("stores the token of an Apple identity linked to an existing account", async () => {
    const account = await googleLogin(
      "google-token-subject-05",
      "apple-token-device-0006",
    );
    const identityToken = await signer.signApple({
      subject: "apple-token-subject-05",
      rawNonce,
    });
    await request(httpServer)
      .post("/v1/me/identities/apple")
      .set("Authorization", `Bearer ${account.tokens.accessToken}`)
      .send({ identityToken, authorizationCode: AUTHORIZATION_CODE, rawNonce })
      .expect(201);

    await expect(
      appleIdentity("apple-token-subject-05"),
    ).resolves.toMatchObject({
      providerTokenState: "STORED",
      providerTokenClientId: APPLE_CLIENT_ID,
    });
    const deletion = await deleteAccount(account);
    expect(apple.revocations).toHaveLength(1);
    expect(deletion).toMatchObject({ providerCredentialRevocation: "revoked" });
  });

  it("has nothing to revoke for an account without an Apple identity", async () => {
    const account = await googleLogin(
      "google-token-subject-06",
      "apple-token-device-0007",
    );

    const deletion = await deleteAccount(account);

    expect(apple.revocations).toHaveLength(0);
    expect(deletion).toMatchObject({
      identityProviders: ["GOOGLE"],
      providerCredentialRevocation: "not_applicable_no_apple_identity",
      appleTokenExchange: null,
    });
  });

  it("refuses provider tokens on a Google identity and unsealed tokens in the database", async () => {
    const google = await googleLogin(
      "google-token-subject-07",
      "apple-token-device-0008",
    );
    await expect(
      database.authIdentity.updateMany({
        where: { userId: google.user.id, provider: "GOOGLE" },
        data: { providerTokenState: "CREDENTIALS_NOT_CONFIGURED" },
      }),
    ).rejects.toThrow();

    await appleLogin("apple-token-subject-08", "apple-token-device-0009");
    await expect(
      database.authIdentity.update({
        where: {
          provider_providerSubject: {
            provider: "APPLE",
            providerSubject: "apple-token-subject-08",
          },
        },
        data: { providerTokenCiphertext: "TEST_ONLY_plaintext_refresh_token" },
      }),
    ).rejects.toThrow();
    await expect(
      database.authIdentity.update({
        where: {
          provider_providerSubject: {
            provider: "APPLE",
            providerSubject: "apple-token-subject-08",
          },
        },
        data: { providerTokenCiphertext: null },
      }),
    ).rejects.toThrow();
  });
});
