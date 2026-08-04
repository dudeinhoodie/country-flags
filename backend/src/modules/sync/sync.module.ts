import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import {
  LEARNING_EVENT_PUBLISHER,
  NoOpLearningEventPublisher,
} from "./learning-event-publisher";
import { LearningOutboxWorker } from "./learning-outbox.worker";
import { UserChangesController } from "./user-changes.controller";
import { UserChangesService } from "./user-changes.service";

@Module({
  imports: [AuthModule],
  controllers: [UserChangesController],
  providers: [
    UserChangesService,
    LearningOutboxWorker,
    {
      provide: LEARNING_EVENT_PUBLISHER,
      useClass: NoOpLearningEventPublisher,
    },
  ],
  exports: [UserChangesService, LearningOutboxWorker],
})
export class SyncModule {}
