import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";

import type { EnvironmentVariables } from "../../../config/environment.validation";
import { TestJwtSigner } from "./test-jwt-signer";

export interface TestAuthenticatedRequest extends Request {
  authenticatedUserId: string;
}

@Injectable()
export class TestAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables>,
    private readonly signer: TestJwtSigner,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.getOrThrow<boolean>("TEST_AUTH_ENABLED")) {
      throw new UnauthorizedException("Test authentication is disabled");
    }

    const request = context
      .switchToHttp()
      .getRequest<TestAuthenticatedRequest>();
    const authorization = request.header("authorization");
    if (authorization === undefined || !authorization.startsWith("Bearer ")) {
      throw new UnauthorizedException("Bearer test token is required");
    }

    try {
      const claims = this.signer.verify(authorization.slice("Bearer ".length));
      request.authenticatedUserId = claims.sub;
      return true;
    } catch {
      throw new UnauthorizedException("Bearer test token is invalid");
    }
  }
}
