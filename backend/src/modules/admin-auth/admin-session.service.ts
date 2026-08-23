import { createHash, createHmac, randomBytes } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AdminUserStatus } from "@prisma/client";
import type { AdminSession, AdminUser } from "@prisma/client";
import type { CookieOptions, Response } from "express";

import {
  isHostedDeploymentEnvironment,
  type DeploymentEnvironment,
} from "../../config/deployment-environment";
import type { EnvironmentVariables } from "../../config/environment.validation";
import { PrismaService } from "../../infrastructure/database/prisma.service";

export const ADMIN_SESSION_COOKIE = "cf_admin_session";

export interface AdminSessionContext {
  ipAddress: string;
  userAgent: string | undefined;
}

export type ActiveAdminSession = AdminSession & { adminUser: AdminUser };

/**
 * Opaque server-side sessions: the browser holds only a random token whose
 * SHA-256 is stored, so a database leak does not leak usable cookies. The
 * idle deadline slides on use and the absolute deadline never moves.
 */
@Injectable()
export class AdminSessionService {
  constructor(
    private readonly database: PrismaService,
    private readonly config: ConfigService<EnvironmentVariables>,
  ) {}

  async issue(
    adminUserId: string,
    context: AdminSessionContext,
  ): Promise<{ token: string; absoluteTtlSeconds: number }> {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const idleTtlSeconds = this.config.getOrThrow<number>(
      "ADMIN_SESSION_IDLE_TTL_SECONDS",
    );
    const absoluteTtlSeconds = this.config.getOrThrow<number>(
      "ADMIN_SESSION_ABSOLUTE_TTL_SECONDS",
    );
    const absoluteExpiresAt = new Date(
      now.getTime() + absoluteTtlSeconds * 1_000,
    );
    await this.database.adminSession.create({
      data: {
        adminUserId,
        tokenHash: this.hashToken(token),
        idleExpiresAt: this.slideIdleDeadline(
          now,
          idleTtlSeconds,
          absoluteExpiresAt,
        ),
        absoluteExpiresAt,
        ipHash: this.hashIp(context.ipAddress),
        userAgent: context.userAgent?.slice(0, 512) ?? null,
      },
      select: { id: true },
    });
    return { token, absoluteTtlSeconds };
  }

  async resolveActive(
    token: string,
    now = new Date(),
  ): Promise<ActiveAdminSession | null> {
    const session = await this.database.adminSession.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { adminUser: true },
    });
    if (
      session === null ||
      session.revokedAt !== null ||
      session.idleExpiresAt <= now ||
      session.absoluteExpiresAt <= now ||
      session.adminUser.status !== AdminUserStatus.ACTIVE
    ) {
      return null;
    }
    return session;
  }

  async touch(session: ActiveAdminSession, now = new Date()): Promise<void> {
    const idleTtlSeconds = this.config.getOrThrow<number>(
      "ADMIN_SESSION_IDLE_TTL_SECONDS",
    );
    await this.database.adminSession.update({
      where: { id: session.id },
      data: {
        lastUsedAt: now,
        idleExpiresAt: this.slideIdleDeadline(
          now,
          idleTtlSeconds,
          session.absoluteExpiresAt,
        ),
      },
      select: { id: true },
    });
  }

  async revoke(sessionId: string, now = new Date()): Promise<void> {
    await this.database.adminSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  attachCookie(response: Response, token: string, maxAgeSeconds: number): void {
    response.cookie(
      ADMIN_SESSION_COOKIE,
      token,
      this.cookieOptions(maxAgeSeconds),
    );
  }

  clearCookie(response: Response): void {
    response.cookie(ADMIN_SESSION_COOKIE, "", this.cookieOptions(0));
  }

  private cookieOptions(maxAgeSeconds: number): CookieOptions {
    const deploymentEnvironment =
      this.config.getOrThrow<DeploymentEnvironment>("DEPLOYMENT_ENV");
    return {
      httpOnly: true,
      sameSite: "lax",
      secure: isHostedDeploymentEnvironment(deploymentEnvironment),
      path: "/",
      maxAge: maxAgeSeconds * 1_000,
    };
  }

  private slideIdleDeadline(
    now: Date,
    idleTtlSeconds: number,
    absoluteExpiresAt: Date,
  ): Date {
    const idleDeadline = new Date(now.getTime() + idleTtlSeconds * 1_000);
    return idleDeadline < absoluteExpiresAt ? idleDeadline : absoluteExpiresAt;
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
}
