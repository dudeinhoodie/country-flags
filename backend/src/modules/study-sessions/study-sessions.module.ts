import { Module } from "@nestjs/common";

import { TestAuthModule } from "../auth/testing/test-auth.module";
import { StudySessionsController } from "./study-sessions.controller";
import { StudySessionsService } from "./study-sessions.service";

@Module({
  imports: [TestAuthModule],
  controllers: [StudySessionsController],
  providers: [StudySessionsService],
})
export class StudySessionsModule {}
