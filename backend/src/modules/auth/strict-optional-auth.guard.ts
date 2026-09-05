import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from "@nestjs/common";

import { ApiException } from "../../common/http/api.exception";
import type { AuthenticatedRequest } from "./auth.guard";
import { OptionalAuthGuard } from "./optional-auth.guard";

/**
 * Identity is optional, but a claim to one is not.
 *
 * A request with no `Authorization` header passes through anonymous, which is
 * how a guest reads a free deck. A request that presents a bearer the server
 * cannot verify is rejected with `401` instead of being quietly demoted to
 * anonymous — otherwise an owner whose access token has just expired would be
 * told the deck needs buying, and the client would show a paywall where a
 * token refresh was called for.
 *
 * That is the difference from {@link OptionalAuthGuard}, which ignores a bad
 * token: on a route where identity only colours the answer (analytics) losing
 * it costs nothing, and on a route where identity decides the answer it costs
 * the caller the truth.
 */
@Injectable()
export class StrictOptionalAuthGuard implements CanActivate {
  constructor(private readonly optionalAuth: OptionalAuthGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.optionalAuth.canActivate(context);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const presentedCredentials = request.header("authorization") !== undefined;
    if (presentedCredentials && request.authenticatedUserId === undefined) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "UNAUTHORIZED",
        "Authentication is required",
      );
    }
    return true;
  }
}
