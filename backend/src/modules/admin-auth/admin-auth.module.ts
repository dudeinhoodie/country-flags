import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AdminAuthService } from "./admin-auth.service";
import { AdminSessionService } from "./admin-session.service";

@Module({
  imports: [AuthModule],
  controllers: [AdminAuthController],
  providers: [AdminAuthGuard, AdminAuthService, AdminSessionService],
  exports: [AdminAuthGuard, AdminSessionService],
})
export class AdminAuthModule {}
