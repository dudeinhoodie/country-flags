import { Module } from "@nestjs/common";

import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { AdminContentController } from "./admin-content.controller";
import { AdminContentService } from "./admin-content.service";

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminContentController],
  providers: [AdminContentService],
})
export class AdminContentModule {}
