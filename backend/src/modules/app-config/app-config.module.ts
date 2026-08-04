import { Module } from "@nestjs/common";

import { AdvertisingPolicyModule } from "../advertising/advertising-policy.module";
import { FeatureFlagsModule } from "../feature-flags/feature-flags.module";
import { AppConfigController } from "./app-config.controller";
import { AppConfigService } from "./app-config.service";

@Module({
  imports: [FeatureFlagsModule, AdvertisingPolicyModule],
  controllers: [AppConfigController],
  providers: [AppConfigService],
})
export class AppConfigModule {}
