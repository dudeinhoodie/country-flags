import { Module } from "@nestjs/common";

import { TestAuthModule } from "../auth/testing/test-auth.module";
import { SchedulerModule } from "../scheduler/scheduler.module";
import { ReviewsController } from "./reviews.controller";
import { ReviewsService } from "./reviews.service";

@Module({
  imports: [TestAuthModule, SchedulerModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
