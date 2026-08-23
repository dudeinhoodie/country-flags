import {
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AdminRole } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import type { AdminAuthenticatedRequest } from "./admin-auth.guard";
import { ADMIN_ROLE_KEY, roleSatisfies } from "./admin-roles";

/**
 * Runs after AdminAuthGuard, which attaches the admin user. Hiding a button
 * in the UI is not access control — this guard is what actually decides.
 */
@Injectable()
export class AdminRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AdminRole | undefined>(
      ADMIN_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (required === undefined) {
      return true;
    }
    const request = context
      .switchToHttp()
      .getRequest<Partial<AdminAuthenticatedRequest>>();
    const adminUser = request.adminUser;
    if (adminUser === undefined) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "UNAUTHORIZED",
        "Admin authentication is required",
      );
    }
    if (!roleSatisfies(adminUser.role, required)) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        "ADMIN_ROLE_FORBIDDEN",
        "This operation requires a higher admin role",
        { requiredRole: required },
      );
    }
    return true;
  }
}
