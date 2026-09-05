import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { CommerceModule } from "../commerce/commerce.module";
import { StudySessionsController } from "./study-sessions.controller";
import { StudySessionsService } from "./study-sessions.service";

@Module({
  imports: [AuthModule, CommerceModule],
  controllers: [StudySessionsController],
  providers: [StudySessionsService],
})
export class StudySessionsModule {}
