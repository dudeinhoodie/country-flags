import {
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { AdminUser } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import type { RequestWithId } from "../../common/http/request-id.middleware";
import {
  ADMIN_SESSION_COOKIE,
  AdminSessionService,
} from "./admin-session.service";

export interface AdminAuthenticatedRequest extends RequestWithId {
  adminUser: AdminUser;
  adminSessionId: string;
}

export function adminSessionTokenFrom(
  cookieHeader: string | undefined,
): string | null {
  if (cookieHeader === undefined) {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() !== ADMIN_SESSION_COOKIE) {
      continue;
    }
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? decodeURIComponent(value) : null;
  }
  return null;
}

function unauthorized(): never {
  throw new ApiException(
    HttpStatus.UNAUTHORIZED,
    "UNAUTHORIZED",
    "Admin authentication is required",
  );
}

/**
 * A DISABLED admin loses access immediately: the user status is re-checked
 * on every request, not only at login, so revocation needs no session sweep.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly sessions: AdminSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AdminAuthenticatedRequest>();
    const token = adminSessionTokenFrom(request.headers.cookie);
    if (token === null) {
      unauthorized();
    }
    const session = await this.sessions.resolveActive(token);
    if (session === null) {
      unauthorized();
    }
    await this.sessions.touch(session);
    request.adminUser = session.adminUser;
    request.adminSessionId = session.id;
    return true;
  }
}
