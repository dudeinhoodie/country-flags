import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AdminAuditService } from "./admin-audit.service";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AdminAuthService } from "./admin-auth.service";
import { AdminRolesGuard } from "./admin-roles.guard";
import { AdminSessionService } from "./admin-session.service";
import { AdminUsersController } from "./admin-users.controller";
import { AdminUsersService } from "./admin-users.service";

@Module({
  imports: [AuthModule],
  controllers: [AdminAuthController, AdminUsersController],
  providers: [
    AdminAuditService,
    AdminAuthGuard,
    AdminAuthService,
    AdminRolesGuard,
    AdminSessionService,
    AdminUsersService,
  ],
  exports: [
    AdminAuditService,
    AdminAuthGuard,
    AdminRolesGuard,
    AdminSessionService,
  ],
})
export class AdminAuthModule {}
