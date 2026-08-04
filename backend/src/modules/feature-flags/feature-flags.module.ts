import { Module } from "@nestjs/common";

import { FeatureFlagsService } from "./feature-flags.service";
import { FEATURE_FLAG_PROVIDER } from "./feature-flags.service";
import { LocalStaticFeatureProvider } from "./local-static-feature-provider";

@Module({
  providers: [
    { provide: FEATURE_FLAG_PROVIDER, useClass: LocalStaticFeatureProvider },
    FeatureFlagsService,
  ],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
