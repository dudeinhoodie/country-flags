import { Global, Module } from "@nestjs/common";

import { RateLimitBucketReaper } from "./rate-limit-bucket-reaper";
import { RateLimiter } from "./rate-limiter.service";

@Global()
@Module({
  providers: [RateLimiter, RateLimitBucketReaper],
  exports: [RateLimiter],
})
export class RateLimiterModule {}
