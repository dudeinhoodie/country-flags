import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ReviewsModule } from "../reviews/reviews.module";
import {
  AccountDeletionController,
  DataExportDownloadsController,
  DataExportsController,
  GuestImportsController,
} from "./account-lifecycle.controller";
import { AccountDeletionService } from "./account-deletion.service";
import { DataExportsService } from "./data-exports.service";
import { GuestImportsService } from "./guest-imports.service";

@Module({
  imports: [AuthModule, ReviewsModule],
  controllers: [
    GuestImportsController,
    DataExportsController,
    DataExportDownloadsController,
    AccountDeletionController,
  ],
  providers: [GuestImportsService, DataExportsService, AccountDeletionService],
  exports: [AccountDeletionService],
})
export class AccountLifecycleModule {}
