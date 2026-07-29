import { Module } from "@nestjs/common";

import { TestAuthGuard } from "./test-auth.guard";
import { TestJwtSigner } from "./test-jwt-signer";

@Module({
  providers: [TestAuthGuard, TestJwtSigner],
  exports: [TestAuthGuard, TestJwtSigner],
})
export class TestAuthModule {}
