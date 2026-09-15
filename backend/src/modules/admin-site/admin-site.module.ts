import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { EnvironmentVariables } from "../../config/environment.validation";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import type { ObjectStorage } from "../../infrastructure/object-storage/object-storage";
import { AdminAuditService } from "../admin-auth/admin-audit.service";
import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { AdminSiteController } from "./admin-site.controller";
import { AdminSiteService } from "./admin-site.service";
import {
  createSiteObjectStorage,
  SITE_OBJECT_STORAGE,
  SiteSnapshotStore,
} from "./site-snapshot-store";

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminSiteController],
  providers: [
    SiteSnapshotStore,
    {
      // The site bucket, or an in-process store when none is configured:
      // local runs and tests then publish somewhere that vanishes with the
      // process, and the status endpoint says so.
      provide: SITE_OBJECT_STORAGE,
      useFactory: (): ObjectStorage => createSiteObjectStorage(),
    },
    {
      // The site's address is configuration rather than a constant, so the
      // service takes it as a value instead of reading config itself.
      provide: AdminSiteService,
      inject: [
        PrismaService,
        AdminAuditService,
        SiteSnapshotStore,
        ConfigService,
      ],
      useFactory: (
        database: PrismaService,
        audit: AdminAuditService,
        snapshot: SiteSnapshotStore,
        config: ConfigService<EnvironmentVariables>,
      ): AdminSiteService =>
        new AdminSiteService(
          database,
          audit,
          snapshot,
          config.get<string | null>("SITE_PUBLIC_URL") ?? null,
        ),
    },
  ],
})
export class AdminSiteModule {}
