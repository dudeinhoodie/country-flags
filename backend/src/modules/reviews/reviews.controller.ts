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
import { type AuthenticatedRequest, AuthGuard } from "../auth/auth.guard";
import { parseReviewBatchRequest } from "./review-batch.request";
import { ReviewsService } from "./reviews.service";

@Controller("reviews")
@UseGuards(AuthGuard)
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  @Post("batch")
  @HttpCode(HttpStatus.OK)
  async ingestBatch(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    await this.rateLimiter.consume(
      "reviews:batch",
      request.authenticatedUserId,
      30,
    );
    return this.reviews.ingestBatch(
      request.authenticatedUserId,
      parseReviewBatchRequest(body),
    );
  }
}
