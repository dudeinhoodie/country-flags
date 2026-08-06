import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

import { RateLimiter } from "../../common/security/rate-limiter.service";
import { type AuthenticatedRequest } from "../auth/auth.guard";
import { OptionalAuthGuard } from "../auth/optional-auth.guard";
import {
  AnalyticsBatchService,
  type BatchIngestionResult,
} from "./analytics-batch.service";

@Controller("analytics")
@UseGuards(OptionalAuthGuard)
export class AnalyticsController {
  constructor(
    private readonly batches: AnalyticsBatchService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  @Post("events/batch")
  @HttpCode(HttpStatus.OK)
  async ingestBatch(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<BatchIngestionResult> {
    await this.rateLimiter.consume(
      "analytics:batch",
      request.authenticatedUserId ?? request.ip ?? "unknown-client",
      20,
    );
    return this.batches.ingest(body, request.authenticatedUserId);
  }
}
