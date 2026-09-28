import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { UserStatus } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import {
  AccessTokenService,
  type AccessTokenClaims,
} from "../auth/access-token.service";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";

/**
 * The gate of `DELETE /v1/me`: a live session, as everywhere else, or proof
 * that the account this token belongs to is already deleted.
 *
 * The deletion removes the account's sessions in the same transaction, so a
 * request whose response was lost cannot be repeated through `AuthGuard`: the
 * retry arrives with a token whose session no longer exists and is answered
 * 401, which the app could only read as "nothing was deleted". The service
 * already answers a repeated deletion with the stored result; this guard lets
 * the repeat reach it (#452).
 *
 * The exception is narrow. The token must verify exactly as `AuthGuard`
 * verifies it (signature, issuer, audience, expiry), its subject must be an
 * account in `DELETED` status with a deletion time, and it must have been
 * issued before that time. A revoked session of an account that still exists
 * is refused as before, so a signed-out token can never delete anything.
 */
@Injectable()
export class AccountDeletionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthGuard,
    private readonly accessTokens: AccessTokenService,
    private readonly database: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await this.auth.canActivate(context);
    } catch (error) {
      if (
        !(error instanceof ApiException) ||
        error.getStatus() !== Number(HttpStatus.UNAUTHORIZED)
      ) {
        throw error;
      }
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
      const claims = await this.deletedAccountClaims(request);
      if (claims === null) {
        throw error;
      }
      request.authenticatedUserId = claims.subject;
      request.authenticatedSessionId = claims.sessionId;
      request.authenticatedAt = claims.issuedAt;
      request.testOnlyAuthentication = false;
      return true;
    }
  }

  private async deletedAccountClaims(
    request: AuthenticatedRequest,
  ): Promise<AccessTokenClaims | null> {
    const authorization = request.header("authorization");
    if (authorization === undefined || !authorization.startsWith("Bearer ")) {
      return null;
    }
    let claims: AccessTokenClaims;
    try {
      claims = await this.accessTokens.verify(
        authorization.slice("Bearer ".length),
      );
    } catch {
      return null;
    }
    const user = await this.database.user.findUnique({
      where: { id: claims.subject },
      select: { status: true, deletedAt: true },
    });
    if (
      user === null ||
      user.status !== UserStatus.DELETED ||
      user.deletedAt === null ||
      claims.issuedAt.getTime() > user.deletedAt.getTime()
    ) {
      return null;
    }
    return claims;
  }
}
