import { Module } from "@nestjs/common";

import { AccessTokenService } from "./access-token.service";
import { AuthController, AuthIdentitiesController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { OptionalAuthGuard } from "./optional-auth.guard";
import { ProviderIdentityVerifier } from "./provider-identity-verifier";
import { ReauthenticationTokenService } from "./reauthentication-token.service";
import { StrictOptionalAuthGuard } from "./strict-optional-auth.guard";
import { TestJwtSigner } from "./testing/test-jwt-signer";
import { TestProviderTokenSigner } from "./testing/test-provider-token-signer";

@Module({
  controllers: [AuthController, AuthIdentitiesController],
  providers: [
    AccessTokenService,
    AuthGuard,
    AuthService,
    OptionalAuthGuard,
    ProviderIdentityVerifier,
    ReauthenticationTokenService,
    StrictOptionalAuthGuard,
    TestJwtSigner,
    TestProviderTokenSigner,
  ],
  exports: [
    AccessTokenService,
    AuthGuard,
    OptionalAuthGuard,
    StrictOptionalAuthGuard,
    ProviderIdentityVerifier,
    ReauthenticationTokenService,
    TestJwtSigner,
    TestProviderTokenSigner,
  ],
})
export class AuthModule {}
