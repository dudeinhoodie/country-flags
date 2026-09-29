import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";

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
import { timeZoneCatalog } from "../../infrastructure/database/time-zones";
import { serializeUser } from "../users/user.serializer";
import { AccessTokenService } from "./access-token.service";
import {
  type AppleTokenGrant,
  appleTokenColumns,
} from "./apple/apple-token-lifecycle.service";
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
  /**
   * When the session's access token is dated. A rotation dates it at the
   * rotation, so a replay inside the grace window re-signs the very same
   * token instead of a new one.
   */
  issuedAt?: Date;
}

/** What a replay needs to know about the rotation it asks for again. */
interface RotationSuccessor {
  id: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  rotatedTo: { id: string } | null;
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

/**
 * How long a refresh token that has just been rotated still answers with the
 * result of that rotation instead of revoking its family (issue #442).
 *
 * The client keeps its old token when a refresh response never arrives — a
 * lift, a suspended app — and presents it again. Inside this window that is a
 * lost response, not a stolen token. Outside it, or once the successor has been
 * used, a replay still revokes the whole family.
 */
export const REFRESH_REPLAY_GRACE_MS = 60_000;

const ROTATION_SUCCESSOR_SELECT = {
  id: true,
  tokenHash: true,
  createdAt: true,
  expiresAt: true,
  revokedAt: true,
  rotatedTo: { select: { id: true } },
} as const;

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
  private successorKeyCache: Buffer | undefined;

  constructor(
    private readonly database: PrismaService,
    private readonly config: ConfigService<EnvironmentVariables>,
    private readonly accessTokens: AccessTokenService,
  ) {}

  async login(
    identity: VerifiedProviderIdentity,
    device: DeviceRegistration,
    context: RequestContext,
    appleToken?: AppleTokenGrant,
  ): Promise<Record<string, unknown>> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const session = await this.persistLogin(
          identity,
          device,
          context,
          appleToken,
        );
        return {
          tokens: await this.issueTokenPair(session),
          user: serializeUser(session.user),
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

  /**
   * The token family a presented refresh token belongs to, or null when the
   * token is unknown. Used to key the per-sign-in refresh budget before any
   * rotation happens.
   */
  async refreshTokenFamily(rawToken: string): Promise<string | null> {
    const session = await this.database.refreshSession.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
      select: { tokenFamilyId: true },
    });
    return session?.tokenFamilyId ?? null;
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
            rotatedTo: { select: ROTATION_SUCCESSOR_SELECT },
            user: { include: { settings: true } },
          },
        });
        if (current === null) {
          return { kind: "invalid" };
        }

        const now = new Date();
        if (current.rotatedTo !== null) {
          const replayed = await this.replayRotation(
            transaction,
            rawToken,
            current,
            current.rotatedTo,
            now,
            context,
          );
          if (replayed !== null) {
            return replayed;
          }
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
          // Another request rotated this token between the read above and
          // the claim. Read committed lets this statement see its successor.
          const raced = await transaction.refreshSession.findUnique({
            where: { id: current.id },
            select: { rotatedTo: { select: ROTATION_SUCCESSOR_SELECT } },
          });
          if (raced?.rotatedTo !== null && raced?.rotatedTo !== undefined) {
            const replayed = await this.replayRotation(
              transaction,
              rawToken,
              current,
              raced.rotatedTo,
              now,
              context,
            );
            if (replayed !== null) {
              return replayed;
            }
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

        // The successor is derived from the token it replaces rather than
        // drawn at random, so a replay of that token inside the grace window
        // can be answered with the same successor without storing it.
        const nextId = randomUUID();
        const refresh = this.successorRefreshMaterial(rawToken, nextId, now);
        const next = await transaction.refreshSession.create({
          data: {
            id: nextId,
            createdAt: now,
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
            issuedAt: now,
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
    appleToken?: AppleTokenGrant,
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
          if (appleToken === undefined) {
            return owner;
          }
          return transaction.authIdentity.update({
            where: { id: owner.id },
            data: appleTokenColumns(appleToken, new Date()),
          });
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
            ...appleTokenColumns(appleToken, new Date()),
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
    appleToken: AppleTokenGrant | undefined,
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
                timezone: await timeZoneCatalog.effective(
                  transaction,
                  device.timezone,
                ),
              },
            },
            authIdentities: {
              create: {
                provider: identity.provider,
                providerSubject: identity.subject,
                email: identity.email,
                emailVerified: identity.emailVerified,
                isPrivateEmail: identity.isPrivateEmail,
                ...appleTokenColumns(appleToken, new Date()),
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
            ...appleTokenColumns(appleToken, new Date()),
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
          // A fresh provider sign-in from a removed device brings it back:
          // the same row keeps its review history under one identifier.
          deletedAt: null,
        },
      });
      const settings = await transaction.userSettings.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          contentLocale: device.locale,
          timezone: await timeZoneCatalog.effective(
            transaction,
            device.timezone,
          ),
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
          ...(appleToken === undefined
            ? {}
            : { appleTokenExchange: appleToken.state }),
        },
      });
      return { id: session.id, user, settings, refresh };
    });
  }

  /**
   * The rotation a replayed token already had, when the replay falls inside
   * the grace window and nobody has used that rotation's token yet; null when
   * the replay has to be treated as reuse.
   *
   * Nothing is minted here: the successor row already exists, and its token is
   * derived again from the one presented, so any number of racing replays all
   * receive the same pair and the family never has two live heads.
   */
  private async replayRotation(
    transaction: Prisma.TransactionClient,
    presentedToken: string,
    current: { userId: string; user: User & { settings: UserSettings | null } },
    successor: RotationSuccessor,
    now: Date,
    context: RequestContext,
  ): Promise<RefreshRotationResult | null> {
    if (
      now.getTime() - successor.createdAt.getTime() > REFRESH_REPLAY_GRACE_MS ||
      successor.rotatedTo !== null ||
      successor.revokedAt !== null ||
      successor.expiresAt.getTime() <= now.getTime()
    ) {
      return null;
    }
    const rawToken = this.successorToken(presentedToken, successor.id);
    // A successor minted before derivation existed, or under another secret,
    // cannot be reproduced; the replay is then judged as it always was.
    if (this.hashToken(rawToken) !== successor.tokenHash) {
      return null;
    }
    if (current.user.status !== "ACTIVE") {
      return { kind: "invalid" };
    }
    await this.audit(transaction, {
      actorUserId: current.userId,
      action: "AUTH_REFRESH_REPLAYED",
      targetType: "REFRESH_SESSION",
      targetId: successor.id,
      requestId: context.requestId,
      metadata: { outcome: "rotation_returned" },
    });
    const settings =
      current.user.settings ??
      (await transaction.userSettings.findUniqueOrThrow({
        where: { userId: current.userId },
      }));
    return {
      kind: "ok",
      session: {
        id: successor.id,
        user: current.user,
        settings,
        refresh: {
          rawToken,
          tokenHash: successor.tokenHash,
          expiresAt: successor.expiresAt,
        },
        issuedAt: successor.createdAt,
      },
    };
  }

  private successorRefreshMaterial(
    presentedToken: string,
    successorId: string,
    now: Date,
  ): RefreshMaterial {
    const rawToken = this.successorToken(presentedToken, successorId);
    const ttl = this.config.getOrThrow<number>(
      "AUTH_REFRESH_TOKEN_TTL_SECONDS",
    );
    return {
      rawToken,
      tokenHash: this.hashToken(rawToken),
      expiresAt: new Date(now.getTime() + ttl * 1_000),
    };
  }

  /**
   * A rotation's new refresh token: a keyed hash of the token it replaces and
   * of the new row's identifier, as long as a random token (384 bits).
   *
   * Only its hash is stored. Reproducing it takes the old token, which only
   * the client holds, the row identifier and the server secret; the database
   * alone yields nothing usable.
   */
  private successorToken(presentedToken: string, successorId: string): string {
    return createHmac("sha384", this.successorKey())
      .update(`${successorId}.${presentedToken}`)
      .digest("base64url");
  }

  /**
   * Derived from the access-token secret with its own label. Whoever holds
   * that secret can already sign access tokens for any session, so the
   * derivation opens nothing that secret did not.
   */
  private successorKey(): Buffer {
    this.successorKeyCache ??= Buffer.from(
      hkdfSync(
        "sha256",
        this.config.getOrThrow<string>("AUTH_ACCESS_TOKEN_SECRET"),
        new Uint8Array(0),
        "country-flags/refresh-token-successor/v1",
        32,
      ),
    );
    return this.successorKeyCache;
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
    // A rotated session's access token is dated at the rotation and named
    // after the session, so a replay re-signs exactly the token the first
    // answer carried. A sign-in's token keeps a random identifier.
    const access =
      session.issuedAt === undefined
        ? await this.accessTokens.sign(session.user.id, session.id)
        : await this.accessTokens.sign(
            session.user.id,
            session.id,
            session.issuedAt,
            session.id,
          );
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
