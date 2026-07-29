import { Module } from "@nestjs/common";

import { AccessTokenService } from "./access-token.service";
import { AuthController, AuthIdentitiesController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthRateLimiter } from "./auth-rate-limiter.service";
import { AuthService } from "./auth.service";
import { ProviderIdentityVerifier } from "./provider-identity-verifier";
import { TestJwtSigner } from "./testing/test-jwt-signer";
import { TestProviderTokenSigner } from "./testing/test-provider-token-signer";

@Module({
  controllers: [AuthController, AuthIdentitiesController],
  providers: [
    AccessTokenService,
    AuthGuard,
    AuthRateLimiter,
    AuthService,
    ProviderIdentityVerifier,
    TestJwtSigner,
    TestProviderTokenSigner,
  ],
  exports: [
    AccessTokenService,
    AuthGuard,
    TestJwtSigner,
    TestProviderTokenSigner,
  ],
})
export class AuthModule {}
