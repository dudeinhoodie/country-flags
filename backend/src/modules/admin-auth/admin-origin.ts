import { HttpStatus } from "@nestjs/common";
import type { Request } from "express";

import { ApiException } from "../../common/http/api.exception";

/**
 * CSRF boundary for admin mutations: browsers attach the Origin header to
 * every POST/PATCH/DELETE they issue, so a missing or unlisted origin means
 * the request did not come from a deployed admin console. The session
 * cookie is additionally SameSite=Lax, this is the second layer.
 */
export function assertTrustedAdminOrigin(
  request: Request,
  allowedOrigins: readonly string[],
): void {
  const origin = request.header("origin");
  if (origin === undefined || !allowedOrigins.includes(origin)) {
    throw new ApiException(
      HttpStatus.FORBIDDEN,
      "ORIGIN_NOT_ALLOWED",
      "The request origin is not allowed for admin operations",
    );
  }
}
