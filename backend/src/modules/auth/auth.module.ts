import { Module } from "@nestjs/common";

import { AccessTokenService } from "./access-token.service";
import { AppleRestTokenClient } from "./apple/apple-rest-token.client";
import { AppleTokenClient } from "./apple/apple-token.client";
import { AppleTokenLifecycle } from "./apple/apple-token-lifecycle.service";
import { AuthController, AuthIdentitiesController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { OptionalAuthGuard } from "./optional-auth.guard";
import { ProviderIdentityVerifier } from "./provider-identity-verifier";
import { ProviderTokenCipher } from "./provider-token-cipher";
import { ReauthenticationTokenService } from "./reauthentication-token.service";
import { StrictOptionalAuthGuard } from "./strict-optional-auth.guard";
import { TestJwtSigner } from "./testing/test-jwt-signer";
import { TestProviderTokenSigner } from "./testing/test-provider-token-signer";

@Module({
  controllers: [AuthController, AuthIdentitiesController],
  providers: [
    AccessTokenService,
    // The Apple REST adapter; e2e tests override this binding with a fake.
    { provide: AppleTokenClient, useClass: AppleRestTokenClient },
    AppleTokenLifecycle,
    AuthGuard,
    AuthService,
    OptionalAuthGuard,
    ProviderIdentityVerifier,
    ProviderTokenCipher,
    ReauthenticationTokenService,
    StrictOptionalAuthGuard,
    TestJwtSigner,
    TestProviderTokenSigner,
  ],
  exports: [
    AccessTokenService,
    AppleTokenLifecycle,
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
