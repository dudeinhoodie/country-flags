import { createHash } from "node:crypto";

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnprocessableEntityException,
} from "@nestjs/common";

import type { RequestWithId } from "../../common/http/request-id.middleware";
import { JsonLoggerService } from "../../common/logging/json-logger.service";
import { RateLimiter } from "../../common/security/rate-limiter.service";
import { parseMetricKitReport } from "./metrickit.request";

@Controller("diagnostics")
export class MetricKitController {
  constructor(
    private readonly logger: JsonLoggerService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  @Post("metrickit")
  @HttpCode(HttpStatus.ACCEPTED)
  async receive(
    @Req() request: RequestWithId,
    @Body() body: unknown,
  ): Promise<void> {
    await this.rateLimiter.consume(
      "diagnostics:metrickit",
      request.ip ?? "unknown-client",
      10,
    );
    const report = parseMetricKitReport(body);
    const decoded = Buffer.from(report.payload, "base64");
    const actualSha256 = createHash("sha256").update(decoded).digest("hex");
    if (actualSha256 !== report.sha256) {
      throw new UnprocessableEntityException(
        "MetricKit payload does not match its declared checksum",
      );
    }

    // The decoded diagnostic payload itself is never logged — only the
    // metadata needed to size and attribute report volume by release.
    this.logger.log({
      message: "MetricKit report received",
      event: "diagnostics_metrickit_received",
      reportId: report.reportId,
      appVersion: report.appVersion,
      build: report.build,
      payloadBytes: decoded.byteLength,
    });
  }
}
