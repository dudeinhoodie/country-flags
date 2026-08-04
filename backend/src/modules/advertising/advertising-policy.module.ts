import { Module } from "@nestjs/common";

import { FeatureFlagsModule } from "../feature-flags/feature-flags.module";
import {
  ADVERTISING_PROVIDER,
  AdvertisingPolicyService,
  NoOpAdvertisingProvider,
} from "./advertising-policy.service";

@Module({
  imports: [FeatureFlagsModule],
  providers: [
    { provide: ADVERTISING_PROVIDER, useClass: NoOpAdvertisingProvider },
    AdvertisingPolicyService,
  ],
  exports: [AdvertisingPolicyService],
})
export class AdvertisingPolicyModule {}
