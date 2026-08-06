import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

import { type AuthenticatedRequest } from "../auth/auth.guard";
import { OptionalAuthGuard } from "../auth/optional-auth.guard";
import {
  AnalyticsBatchService,
  type BatchIngestionResult,
} from "./analytics-batch.service";

@Controller("analytics")
@UseGuards(OptionalAuthGuard)
export class AnalyticsController {
  constructor(private readonly batches: AnalyticsBatchService) {}

  @Post("events/batch")
  @HttpCode(HttpStatus.OK)
  ingestBatch(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<BatchIngestionResult> {
    return this.batches.ingest(body, request.authenticatedUserId);
  }
}
