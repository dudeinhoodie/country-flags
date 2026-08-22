import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  type AuthIdentity,
  Prisma,
  type User,
  type UserSettings,
} from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import type { EnvironmentVariables } from "../../config/environment.validation";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { inSerializableTransaction } from "../../infrastructure/database/serializable-transaction";
import { AccessTokenService } from "./access-token.service";
import type { DeviceRegistration } from "./auth.request";
import type { VerifiedProviderIdentity } from "./provider-identity-verifier";

interface RequestContext {
  requestId: string;
  ipAddress: string;
  userAgent: string | undefined;
}

interface RefreshMaterial {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
}

interface SessionRecord {
  id: string;
  user: User;
  settings: UserSettings;
  refresh: RefreshMaterial;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
}

type RefreshRotationResult =
  | { kind: "ok"; session: SessionRecord }
  | { kind: "invalid" }
  | { kind: "reused" };

function typedError(
  status: HttpStatus,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): never {
  throw new ApiException(status, code, message, details);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: PrismaService,
    private readonly config: ConfigService<EnvironmentVariables>,
    private readonly accessTokens: AccessTokenService,
  ) {}

  async login(
    identity: VerifiedProviderIdentity,
    device: DeviceRegistration,
    context: RequestContext,
  ): Promise<Record<string, unknown>> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const session = await this.persistLogin(identity, device, context);
        return {
          tokens: await this.issueTokenPair(session),
          user: this.serializeUser(session.user),
          settings: this.serializeSettings(session.settings),
          serverTime: new Date().toISOString(),
        };
      } catch (error) {
        lastError = error;
        if (
          !(
            error instanceof Prisma.PrismaClientKnownRequestError &&
            ["P2002", "P2034"].includes(error.code)
          )
        ) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  async recordAuthenticationFailure(
    provider: "APPLE" | "GOOGLE",
    requestId: string,
  ): Promise<void> {
    await this.database.auditEvent.create({
      data: {
        actorUserId: null,
        action: "AUTH_LOGIN_FAILED",
        targetType: "AUTH_PROVIDER",
        targetId: null,
        requestId,
        metadata: {
          provider,
          outcome: "credentials_rejected",
        },
      },
    });
  }

  async rotateRefreshToken(
    rawToken: string,
    context: RequestContext,
  ): Promise<TokenPair> {
    const tokenHash = this.hashToken(rawToken);
    const result = await this.database.$transaction(
      async (transaction): Promise<RefreshRotationResult> => {
        const current = await transaction.refreshSession.findUnique({
          where: { tokenHash },
          include: {
            rotatedTo: { select: { id: true } },
            user: { include: { settings: true } },
          },
        });
        if (current === null) {
          return { kind: "invalid" };
        }

        const now = new Date();
        if (current.rotatedTo !== null) {
          await this.revokeFamily(
            transaction,
            current.userId,
            current.tokenFamilyId,
            now,
          );
          await this.audit(transaction, {
            actorUserId: current.userId,
            action: "AUTH_REFRESH_REUSE_DETECTED",
            targetType: "REFRESH_TOKEN_FAMILY",
            targetId: current.tokenFamilyId,
            requestId: context.requestId,
            metadata: { outcome: "family_revoked" },
          });
          return { kind: "reused" };
        }
        if (
          current.revokedAt !== null ||
          current.expiresAt.getTime() <= now.getTime() ||
          current.user.status !== "ACTIVE"
        ) {
          if (current.revokedAt === null) {
            await transaction.refreshSession.update({
              where: { id: current.id },
              data: { revokedAt: now },
            });
          }
          return { kind: "invalid" };
        }

        const claimed = await transaction.refreshSession.updateMany({
          where: {
            id: current.id,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { revokedAt: now, lastUsedAt: now },
        });
        if (claimed.count !== 1) {
          const raced = await transaction.refreshSession.findUnique({
            where: { id: current.id },
            select: { rotatedTo: { select: { id: true } } },
          });
          if (raced?.rotatedTo !== null && raced?.rotatedTo !== undefined) {
            await this.revokeFamily(
              transaction,
              current.userId,
              current.tokenFamilyId,
              now,
            );
            await this.audit(transaction, {
              actorUserId: current.userId,
              action: "AUTH_REFRESH_REUSE_DETECTED",
              targetType: "REFRESH_TOKEN_FAMILY",
              targetId: current.tokenFamilyId,
              requestId: context.requestId,
              metadata: { outcome: "concurrent_family_revoked" },
            });
            return { kind: "reused" };
          }
          return { kind: "invalid" };
        }

        const refresh = this.createRefreshMaterial(now);
        const next = await transaction.refreshSession.create({
          data: {
            userId: current.userId,
            deviceId: current.deviceId,
            tokenHash: refresh.tokenHash,
            tokenFamilyId: current.tokenFamilyId,
            rotatedFromId: current.id,
            expiresAt: refresh.expiresAt,
            ipHash: this.hashIp(context.ipAddress),
            userAgent: this.safeUserAgent(context.userAgent),
          },
          select: { id: true },
        });
        await this.audit(transaction, {
          actorUserId: current.userId,
          action: "AUTH_REFRESH_ROTATED",
          targetType: "REFRESH_SESSION",
          targetId: next.id,
          requestId: context.requestId,
          metadata: { outcome: "succeeded" },
        });
        const settings =
          current.user.settings ??
          (await transaction.userSettings.create({
            data: { userId: current.userId },
          }));
        return {
          kind: "ok",
          session: {
            id: next.id,
            user: current.user,
            settings,
            refresh,
          },
        };
      },
    );

    if (result.kind === "reused") {
      typedError(
        HttpStatus.UNAUTHORIZED,
        "REFRESH_TOKEN_REUSED",
        "A rotated refresh token was reused; the token family was revoked",
      );
    }
    if (result.kind === "invalid") {
      typedError(
        HttpStatus.UNAUTHORIZED,
        "REFRESH_TOKEN_INVALID",
        "Refresh token is invalid or expired",
      );
    }
    return this.issueTokenPair(result.session);
  }

  async logout(
    userId: string,
    sessionId: string,
    refreshToken: string | undefined,
    requestId: string,
  ): Promise<void> {
    if (refreshToken !== undefined) {
      const supplied = await this.database.refreshSession.findUnique({
        where: { tokenHash: this.hashToken(refreshToken) },
        select: { id: true, userId: true },
      });
      if (
        supplied === null ||
        supplied.id !== sessionId ||
        supplied.userId !== userId
      ) {
        typedError(
          HttpStatus.UNAUTHORIZED,
          "REFRESH_TOKEN_INVALID",
          "Refresh token does not belong to the current session",
        );
      }
    }

    const now = new Date();
    await this.database.$transaction(async (transaction) => {
      await transaction.refreshSession.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit(transaction, {
        actorUserId: userId,
        action: "AUTH_LOGOUT",
        targetType: "REFRESH_SESSION",
        targetId: sessionId,
        requestId,
        metadata: { outcome: "revoked" },
      });
    });
  }

  async logoutAll(userId: string, requestId: string): Promise<void> {
    const now = new Date();
    await this.database.$transaction(async (transaction) => {
      const revoked = await transaction.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit(transaction, {
        actorUserId: userId,
        action: "AUTH_LOGOUT_ALL",
        targetType: "USER",
        targetId: userId,
        requestId,
        metadata: { revokedSessionCount: revoked.count },
      });
    });
  }

  async listIdentities(userId: string): Promise<Record<string, unknown>> {
    const identities = await this.database.authIdentity.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { provider: "asc" }],
    });
    return {
      items: identities.map((identity) => this.serializeIdentity(identity)),
    };
  }

  async linkIdentity(
    userId: string,
    identity: VerifiedProviderIdentity,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    try {
      const linked = await this.database.$transaction(async (transaction) => {
        const owner = await transaction.authIdentity.findUnique({
          where: {
            provider_providerSubject: {
              provider: identity.provider,
              providerSubject: identity.subject,
            },
          },
        });
        if (owner !== null) {
          if (owner.userId !== userId) {
            typedError(
              HttpStatus.CONFLICT,
              "IDENTITY_ALREADY_LINKED",
              "This provider identity is already linked to another account",
              { provider: identity.provider },
            );
          }
          return owner;
        }
        const providerIdentity = await transaction.authIdentity.findUnique({
          where: {
            userId_provider: {
              userId,
              provider: identity.provider,
            },
          },
        });
        if (providerIdentity !== null) {
          typedError(
            HttpStatus.CONFLICT,
            "PROVIDER_ALREADY_LINKED",
            "This account already has another identity for the provider",
            { provider: identity.provider },
          );
        }
        const created = await transaction.authIdentity.create({
          data: {
            userId,
            provider: identity.provider,
            providerSubject: identity.subject,
            email: identity.email,
            emailVerified: identity.emailVerified,
            isPrivateEmail: identity.isPrivateEmail,
          },
        });
        await this.audit(transaction, {
          actorUserId: userId,
          action: "AUTH_IDENTITY_LINKED",
          targetType: "AUTH_IDENTITY",
          targetId: created.id,
          requestId,
          metadata: { provider: identity.provider },
        });
        return created;
      });
      return this.serializeIdentity(linked);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const owner = await this.database.authIdentity.findUnique({
          where: {
            provider_providerSubject: {
              provider: identity.provider,
              providerSubject: identity.subject,
            },
          },
        });
        if (owner !== null && owner.userId !== userId) {
          typedError(
            HttpStatus.CONFLICT,
            "IDENTITY_ALREADY_LINKED",
            "This provider identity is already linked to another account",
            { provider: identity.provider },
          );
        }
        typedError(
          HttpStatus.CONFLICT,
          "PROVIDER_ALREADY_LINKED",
          "This account already has another identity for the provider",
          { provider: identity.provider },
        );
      }
      throw error;
    }
  }

  async unlinkIdentity(
    userId: string,
    provider: "APPLE" | "GOOGLE",
    requestId: string,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      const identities = await transaction.authIdentity.findMany({
        where: { userId },
        select: { id: true, provider: true },
      });
      const target = identities.find(
        (identity) => identity.provider === provider,
      );
      if (target === undefined) {
        typedError(
          HttpStatus.NOT_FOUND,
          "IDENTITY_NOT_FOUND",
          "The authentication identity was not found",
          { provider },
        );
      }
      if (identities.length <= 1) {
        typedError(
          HttpStatus.CONFLICT,
          "LAST_IDENTITY_CANNOT_BE_REMOVED",
          "The last authentication identity cannot be removed",
          { provider },
        );
      }
      await transaction.authIdentity.delete({ where: { id: target.id } });
      await this.audit(transaction, {
        actorUserId: userId,
        action: "AUTH_IDENTITY_UNLINKED",
        targetType: "AUTH_IDENTITY",
        targetId: target.id,
        requestId,
        metadata: { provider },
      });
    });
  }

  private async persistLogin(
    identity: VerifiedProviderIdentity,
    device: DeviceRegistration,
    context: RequestContext,
  ): Promise<SessionRecord> {
    return inSerializableTransaction(this.database, async (transaction) => {
      // Read once. The branch below used to re-read the identity it had
      // just created, in the same transaction, into a variable nothing
      // downstream looks at — a round trip to the database for a value that
      // was discarded.
      const linked = await transaction.authIdentity.findUnique({
        where: {
          provider_providerSubject: {
            provider: identity.provider,
            providerSubject: identity.subject,
          },
        },
        include: { user: true },
      });
      let user: User;
      let accountCreated = false;
      if (linked === null) {
        accountCreated = true;
        user = await transaction.user.create({
          data: {
            preferredLocale: device.locale,
            settings: {
              create: {
                contentLocale: device.locale,
                timezone: device.timezone,
              },
            },
            authIdentities: {
              create: {
                provider: identity.provider,
                providerSubject: identity.subject,
                email: identity.email,
                emailVerified: identity.emailVerified,
                isPrivateEmail: identity.isPrivateEmail,
              },
            },
          },
        });
      } else {
        user = linked.user;
        if (user.status !== "ACTIVE") {
          typedError(
            HttpStatus.UNAUTHORIZED,
            "ACCOUNT_UNAVAILABLE",
            "The account is not available for authentication",
          );
        }
        await transaction.authIdentity.update({
          where: { id: linked.id },
          data: {
            lastLoginAt: new Date(),
            email: identity.email,
            emailVerified: identity.emailVerified,
            isPrivateEmail: identity.isPrivateEmail,
          },
        });
      }

      const registeredDevice = await transaction.device.upsert({
        where: {
          userId_clientGeneratedId: {
            userId: user.id,
            clientGeneratedId: device.clientGeneratedId,
          },
        },
        create: {
          userId: user.id,
          clientGeneratedId: device.clientGeneratedId,
          platform: device.platform,
          appVersion: device.appVersion,
          locale: device.locale,
          timezone: device.timezone,
        },
        update: {
          platform: device.platform,
          appVersion: device.appVersion,
          locale: device.locale,
          timezone: device.timezone,
          lastSeenAt: new Date(),
        },
      });
      const settings = await transaction.userSettings.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          contentLocale: device.locale,
          timezone: device.timezone,
        },
        update: {},
      });
      const refresh = this.createRefreshMaterial();
      const session = await transaction.refreshSession.create({
        data: {
          userId: user.id,
          deviceId: registeredDevice.id,
          tokenHash: refresh.tokenHash,
          tokenFamilyId: randomUUID(),
          expiresAt: refresh.expiresAt,
          ipHash: this.hashIp(context.ipAddress),
          userAgent: this.safeUserAgent(context.userAgent),
        },
        select: { id: true },
      });
      await this.audit(transaction, {
        actorUserId: user.id,
        action: "AUTH_LOGIN_SUCCEEDED",
        targetType: "REFRESH_SESSION",
        targetId: session.id,
        requestId: context.requestId,
        metadata: {
          provider: identity.provider,
          accountCreated,
        },
      });
      return { id: session.id, user, settings, refresh };
    });
  }

  private createRefreshMaterial(now = new Date()): RefreshMaterial {
    const rawToken = randomBytes(48).toString("base64url");
    const ttl = this.config.getOrThrow<number>(
      "AUTH_REFRESH_TOKEN_TTL_SECONDS",
    );
    return {
      rawToken,
      tokenHash: this.hashToken(rawToken),
      expiresAt: new Date(now.getTime() + ttl * 1_000),
    };
  }

  private async issueTokenPair(session: SessionRecord): Promise<TokenPair> {
    const access = await this.accessTokens.sign(session.user.id, session.id);
    return {
      accessToken: access.token,
      refreshToken: session.refresh.rawToken,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
    };
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private hashIp(ipAddress: string): string {
    return createHmac(
      "sha256",
      this.config.getOrThrow<string>("AUTH_RATE_LIMIT_SECRET"),
    )
      .update(ipAddress)
      .digest("hex");
  }

  private safeUserAgent(userAgent: string | undefined): string | null {
    return userAgent === undefined ? null : userAgent.slice(0, 512);
  }

  private async revokeFamily(
    transaction: Prisma.TransactionClient,
    userId: string,
    familyId: string,
    now: Date,
  ): Promise<void> {
    await transaction.refreshSession.updateMany({
      where: { userId, tokenFamilyId: familyId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  private audit(
    transaction: Prisma.TransactionClient,
    event: {
      actorUserId: string | null;
      action: string;
      targetType: string;
      targetId: string | null;
      requestId: string;
      metadata: Prisma.InputJsonValue;
    },
  ): Promise<unknown> {
    return transaction.auditEvent.create({ data: event });
  }

  private serializeUser(user: User): Record<string, unknown> {
    return {
      id: user.id,
      displayName: user.displayName,
      preferredLocale: user.preferredLocale,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private serializeSettings(settings: UserSettings): Record<string, unknown> {
    return {
      sessionSize: settings.sessionSize,
      contentLocale: settings.contentLocale,
      defaultAnswerMode: settings.defaultAnswerMode,
      extraFactTypes: settings.extraFactTypes,
      soundEnabled: settings.soundEnabled,
      hapticsEnabled: settings.hapticsEnabled,
      remindersEnabled: settings.remindersEnabled,
      reminderLocalTime:
        settings.reminderLocalTime === null
          ? null
          : settings.reminderLocalTime.toISOString().slice(11, 16),
      reminderWeekdays: settings.reminderWeekdays,
      desiredRetention: Number(settings.desiredRetention),
      timezone: settings.timezone,
      version: settings.version,
      updatedAt: settings.updatedAt.toISOString(),
    };
  }

  private serializeIdentity(identity: AuthIdentity): Record<string, unknown> {
    return {
      id: identity.id,
      provider: identity.provider,
      createdAt: identity.createdAt.toISOString(),
      lastLoginAt: identity.lastLoginAt.toISOString(),
    };
  }
}
