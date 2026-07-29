import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { EnvironmentVariables } from "../../config/environment.validation";

export interface AccessTokenClaims {
  subject: string;
  sessionId: string;
  issuedAt: Date;
  expiresAt: Date;
  tokenId: string;
}

@Injectable()
export class AccessTokenService {
  constructor(private readonly config: ConfigService<EnvironmentVariables>) {}

  async sign(
    subject: string,
    sessionId: string,
    now = new Date(),
  ): Promise<{ token: string; expiresAt: Date }> {
    const { SignJWT } = await import("jose");
    const ttl = this.config.getOrThrow<number>("AUTH_ACCESS_TOKEN_TTL_SECONDS");
    const expiresAt = new Date(now.getTime() + ttl * 1_000);
    const token = await new SignJWT({ sessionId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(subject)
      .setIssuer(this.config.getOrThrow<string>("AUTH_ACCESS_TOKEN_ISSUER"))
      .setAudience(this.config.getOrThrow<string>("AUTH_ACCESS_TOKEN_AUDIENCE"))
      .setJti(randomUUID())
      .setIssuedAt(Math.floor(now.getTime() / 1_000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
      .sign(this.key());
    return { token, expiresAt };
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    const { jwtVerify } = await import("jose");
    const result = await jwtVerify(token, this.key(), {
      algorithms: ["HS256"],
      issuer: this.config.getOrThrow<string>("AUTH_ACCESS_TOKEN_ISSUER"),
      audience: this.config.getOrThrow<string>("AUTH_ACCESS_TOKEN_AUDIENCE"),
      requiredClaims: ["sub", "sessionId", "jti", "iat", "exp"],
      clockTolerance: 5,
    });
    const { sub, sessionId, jti, iat, exp } = result.payload;
    if (
      typeof sub !== "string" ||
      typeof sessionId !== "string" ||
      typeof jti !== "string" ||
      typeof iat !== "number" ||
      typeof exp !== "number"
    ) {
      throw new Error("Access token claims are invalid");
    }
    return {
      subject: sub,
      sessionId,
      tokenId: jti,
      issuedAt: new Date(iat * 1_000),
      expiresAt: new Date(exp * 1_000),
    };
  }

  private key(): Uint8Array {
    return new TextEncoder().encode(
      this.config.getOrThrow<string>("AUTH_ACCESS_TOKEN_SECRET"),
    );
  }
}
