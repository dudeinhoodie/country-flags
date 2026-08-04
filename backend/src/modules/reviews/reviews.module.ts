import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ProgressModule } from "../progress/progress.module";
import { SchedulerModule } from "../scheduler/scheduler.module";
import { ReviewsController } from "./reviews.controller";
import { ReviewsService } from "./reviews.service";

@Module({
  imports: [AuthModule, ProgressModule, SchedulerModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
