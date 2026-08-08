import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ProgressDeletionService } from "./progress-deletion.service";
import { ProgressController } from "./progress.controller";
import { ProgressService } from "./progress.service";

@Module({
  imports: [AuthModule],
  controllers: [ProgressController],
  providers: [ProgressDeletionService, ProgressService],
  exports: [ProgressService],
})
export class ProgressModule {}
