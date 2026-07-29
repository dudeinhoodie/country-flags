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
  provider: "APPLE" | "GOOGLE";
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

  async verify(
    token: string | undefined,
    userId: string,
    sessionId: string,
  ): Promise<ReauthenticationClaims> {
    if (token === undefined || token.length < 32 || token.length > 4_096) {
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
