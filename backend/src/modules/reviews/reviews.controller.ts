import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

import {
  type TestAuthenticatedRequest,
  TestAuthGuard,
} from "../auth/testing/test-auth.guard";
import { parseReviewBatchRequest } from "./review-batch.request";
import { ReviewsService } from "./reviews.service";

@Controller("reviews")
@UseGuards(TestAuthGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post("batch")
  @HttpCode(HttpStatus.OK)
  ingestBatch(
    @Req() request: TestAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.reviews.ingestBatch(
      request.authenticatedUserId,
      parseReviewBatchRequest(body),
    );
  }
}
