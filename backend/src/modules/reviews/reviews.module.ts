import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ProgressModule } from "../progress/progress.module";
import { SchedulerModule } from "../scheduler/scheduler.module";
import { SyncModule } from "../sync/sync.module";
import { ReviewsController } from "./reviews.controller";
import { ReconciliationWorker } from "./reconciliation.worker";
import { ReviewsService } from "./reviews.service";
import { SchedulerMigrationWorker } from "./scheduler-migration.worker";

@Module({
  imports: [AuthModule, ProgressModule, SchedulerModule, SyncModule],
  controllers: [ReviewsController],
  providers: [ReviewsService, ReconciliationWorker, SchedulerMigrationWorker],
  exports: [ReviewsService, ReconciliationWorker, SchedulerMigrationWorker],
})
export class ReviewsModule {}
