import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";

import { ApiException } from "../../common/http/api.exception";
import type { EnvironmentVariables } from "../../config/environment.validation";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AccessTokenService } from "./access-token.service";
import { TestJwtSigner } from "./testing/test-jwt-signer";

export interface AuthenticatedRequest extends Request {
  authenticatedUserId: string;
  authenticatedSessionId: string | null;
  authenticatedAt: Date;
  testOnlyAuthentication: boolean;
}

function unauthorized(): never {
  throw new ApiException(
    HttpStatus.UNAUTHORIZED,
    "UNAUTHORIZED",
    "Authentication is required",
  );
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables>,
    private readonly accessTokens: AccessTokenService,
    private readonly database: PrismaService,
    private readonly testSigner: TestJwtSigner,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.header("authorization");
    if (authorization === undefined || !authorization.startsWith("Bearer ")) {
      unauthorized();
    }
    const token = authorization.slice("Bearer ".length);

    let accessClaims:
      | Awaited<ReturnType<AccessTokenService["verify"]>>
      | undefined;
    try {
      accessClaims = await this.accessTokens.verify(token);
    } catch {
      accessClaims = undefined;
    }
    if (accessClaims !== undefined) {
      const session = await this.database.refreshSession.findFirst({
        where: {
          id: accessClaims.sessionId,
          userId: accessClaims.subject,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { status: "ACTIVE" },
        },
        select: { id: true },
      });
      if (session === null) {
        unauthorized();
      }
      request.authenticatedUserId = accessClaims.subject;
      request.authenticatedSessionId = accessClaims.sessionId;
      request.authenticatedAt = accessClaims.issuedAt;
      request.testOnlyAuthentication = false;
      return true;
    }

    if (this.config.getOrThrow<boolean>("TEST_AUTH_ENABLED")) {
      try {
        const claims = this.testSigner.verify(token);
        request.authenticatedUserId = claims.sub;
        request.authenticatedSessionId = null;
        request.authenticatedAt = new Date(claims.iat * 1_000);
        request.testOnlyAuthentication = true;
        return true;
      } catch {
        unauthorized();
      }
    }
    unauthorized();
  }
}
