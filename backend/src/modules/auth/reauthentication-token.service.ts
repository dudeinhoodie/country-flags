import { randomUUID } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { ApiException } from "../../common/http/api.exception";
import type { EnvironmentVariables } from "../../config/environment.validation";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import type { VerifiedProviderIdentity } from "./provider-identity-verifier";

interface ReauthenticationClaims {
  subject: string;
  sessionId: string;
  /// Who vouched for the person. `SESSION` means the sign-in that created this
  /// session was itself recent enough to count — nobody was asked twice.
  provider: "APPLE" | "GOOGLE" | "SESSION";
  authenticatedAt: Date;
  expiresAt: Date;
}

function unauthorized(code: string, message: string): never {
  throw new ApiException(HttpStatus.UNAUTHORIZED, code, message);
}

@Injectable()
export class ReauthenticationTokenService {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables>,
    private readonly database: PrismaService,
  ) {}

  async issue(
    userId: string,
    sessionId: string,
    identity: VerifiedProviderIdentity,
    requestId: string,
    now = new Date(),
  ): Promise<Record<string, unknown>> {
    const maximumAgeMs =
      this.config.getOrThrow<number>("AUTH_REAUTH_TOKEN_TTL_SECONDS") * 1_000;
    if (
      identity.issuedAt.getTime() > now.getTime() + 30_000 ||
      now.getTime() - identity.issuedAt.getTime() > maximumAgeMs
    ) {
      unauthorized(
        "REAUTHENTICATION_NOT_FRESH",
        "A newly issued provider credential is required",
      );
    }
    const linked = await this.database.authIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider: identity.provider,
          providerSubject: identity.subject,
        },
      },
      select: { userId: true },
    });
    if (linked === null || linked.userId !== userId) {
      unauthorized(
        "REAUTHENTICATION_IDENTITY_MISMATCH",
        "The provider identity does not belong to the current account",
      );
    }

    const { SignJWT } = await import("jose");
    const ttl = this.config.getOrThrow<number>("AUTH_REAUTH_TOKEN_TTL_SECONDS");
    const expiresAt = new Date(now.getTime() + ttl * 1_000);
    const token = await new SignJWT({
      sessionId,
      provider: identity.provider,
      purpose: "reauthentication",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(userId)
      .setIssuer(this.issuer())
      .setAudience(this.audience())
      .setJti(randomUUID())
      .setIssuedAt(Math.floor(now.getTime() / 1_000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
      .sign(this.key());

    await this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        action: "AUTH_REAUTHENTICATED",
        targetType: "REFRESH_SESSION",
        targetId: sessionId,
        requestId,
        metadata: { provider: identity.provider },
      },
    });

    return {
      reauthenticationToken: token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /// Whether this session was created by a provider sign-in recently enough to
  /// count as the fresh authentication a sensitive operation needs.
  ///
  /// Signing in *is* proving who you are. Asking somebody to do it twice inside
  /// five minutes — once to get in, once to ask for their own data — is
  /// ceremony, not security: the second round trip proves exactly what the
  /// first one proved a moment earlier. The window is the same one a minted
  /// proof lives for, so nothing is trusted for longer than a proof would be.
  ///
  /// The family's first row is when the person actually answered the provider;
  /// rotations since then are the app refreshing its own token, which proves
  /// nothing about who is holding the phone.
  private async authenticatedAtIfRecent(
    userId: string,
    sessionId: string,
  ): Promise<Date | null> {
    const session = await this.database.refreshSession.findFirst({
      where: { id: sessionId, userId, revokedAt: null },
      select: { tokenFamilyId: true },
    });
    if (session === null) {
      return null;
    }
    const origin = await this.database.refreshSession.findFirst({
      where: { userId, tokenFamilyId: session.tokenFamilyId },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    if (origin === null) {
      return null;
    }
    const ttl = this.config.getOrThrow<number>("AUTH_REAUTH_TOKEN_TTL_SECONDS");
    const age = Date.now() - origin.createdAt.getTime();
    return age <= ttl * 1_000 ? origin.createdAt : null;
  }

  async verify(
    token: string | undefined,
    userId: string,
    sessionId: string,
  ): Promise<ReauthenticationClaims> {
    if (token === undefined || token.length < 32 || token.length > 4_096) {
      const recent = await this.authenticatedAtIfRecent(userId, sessionId);
      if (recent !== null) {
        const ttl = this.config.getOrThrow<number>(
          "AUTH_REAUTH_TOKEN_TTL_SECONDS",
        );
        return {
          subject: userId,
          sessionId,
          provider: "SESSION",
          authenticatedAt: recent,
          expiresAt: new Date(recent.getTime() + ttl * 1_000),
        };
      }
      unauthorized(
        "REAUTHENTICATION_REQUIRED",
        "Fresh provider reauthentication is required",
      );
    }
    try {
      const { jwtVerify } = await import("jose");
      const result = await jwtVerify(token, this.key(), {
        algorithms: ["HS256"],
        issuer: this.issuer(),
        audience: this.audience(),
        requiredClaims: [
          "sub",
          "sessionId",
          "provider",
          "purpose",
          "iat",
          "exp",
        ],
        clockTolerance: 5,
      });
      const {
        sub,
        sessionId: claimSessionId,
        provider,
        purpose,
        iat,
        exp,
      } = result.payload;
      if (
        sub !== userId ||
        claimSessionId !== sessionId ||
        purpose !== "reauthentication" ||
        (provider !== "APPLE" && provider !== "GOOGLE") ||
        typeof iat !== "number" ||
        typeof exp !== "number"
      ) {
        unauthorized(
          "REAUTHENTICATION_INVALID",
          "Reauthentication proof is invalid for the current session",
        );
      }
      return {
        subject: sub,
        sessionId: claimSessionId,
        provider,
        authenticatedAt: new Date(iat * 1_000),
        expiresAt: new Date(exp * 1_000),
      };
    } catch (error) {
      if (error instanceof ApiException) {
        throw error;
      }
      unauthorized(
        "REAUTHENTICATION_INVALID",
        "Reauthentication proof is invalid or expired",
      );
    }
  }

  private issuer(): string {
    return this.config.getOrThrow<string>("AUTH_ACCESS_TOKEN_ISSUER");
  }

  private audience(): string {
    return `${this.config.getOrThrow<string>(
      "AUTH_ACCESS_TOKEN_AUDIENCE",
    )}:reauthentication`;
  }

  private key(): Uint8Array {
    return new TextEncoder().encode(
      this.config.getOrThrow<string>("AUTH_ACCESS_TOKEN_SECRET"),
    );
  }
}
