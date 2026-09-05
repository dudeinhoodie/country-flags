import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { DeploymentEnvironment } from "../../../config/deployment-environment";
import type { EnvironmentVariables } from "../../../config/environment.validation";
import { PrismaService } from "../../../infrastructure/database/prisma.service";
import { AdminAuditService } from "../../admin-auth/admin-audit.service";
import { AdminAuthModule } from "../../admin-auth/admin-auth.module";
import { storeEnvironmentFor } from "../store-environment";
import { AdminCommerceController } from "./admin-commerce.controller";
import { AdminCommerceService } from "./admin-commerce.service";
import { StoreSyncRunService } from "./store-sync-run.service";
import { StoreTransactionService } from "./store-transaction.service";

/**
 * The console's side of the storefront (17-paid-decks-storekit §12.2).
 *
 * Separate from `CommerceModule`, which answers what an account may open:
 * that runs on every request a customer makes, and this runs when an
 * operator opens a screen. Nothing here is reachable without an admin
 * session.
 */
@Module({
  imports: [AdminAuthModule],
  controllers: [AdminCommerceController],
  providers: [
    StoreTransactionService,
    {
      // Which store this deployment talks to is derived from the deployment
      // rather than read as configuration of its own, so it is passed in as
      // a value: a service that could look it up could look up the wrong one.
      provide: AdminCommerceService,
      inject: [PrismaService, AdminAuditService, ConfigService],
      useFactory: (
        database: PrismaService,
        audit: AdminAuditService,
        config: ConfigService<EnvironmentVariables>,
      ): AdminCommerceService =>
        new AdminCommerceService(
          database,
          audit,
          storeEnvironmentFor(
            config.getOrThrow<DeploymentEnvironment>("DEPLOYMENT_ENV"),
          ),
        ),
    },
    {
      provide: StoreSyncRunService,
      inject: [PrismaService, AdminAuditService, ConfigService],
      useFactory: (
        database: PrismaService,
        audit: AdminAuditService,
        config: ConfigService<EnvironmentVariables>,
      ): StoreSyncRunService =>
        new StoreSyncRunService(
          database,
          audit,
          storeEnvironmentFor(
            config.getOrThrow<DeploymentEnvironment>("DEPLOYMENT_ENV"),
          ),
        ),
    },
  ],
})
export class AdminCommerceModule {}
