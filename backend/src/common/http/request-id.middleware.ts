import { randomUUID } from "node:crypto";

import { Injectable, type NestMiddleware } from "@nestjs/common";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { NextFunction, Request, Response } from "express";

import { MetricsService } from "../telemetry/metrics.service";
import { JsonLoggerService } from "../logging/json-logger.service";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEALTH_ROUTE_PREFIX = "/v1/health/";
const TRACER_NAME = "country-flags-api";

export interface RequestWithId extends Request {
  requestId: string;
}

function routeTemplate(request: Request): string {
  const matchedPath = (request.route as { path?: string } | undefined)?.path;
  return matchedPath ?? request.originalUrl.split("?")[0] ?? request.path;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(
    private readonly logger: JsonLoggerService,
    private readonly metrics: MetricsService,
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    const incomingRequestId = request.header("x-request-id");
    const requestId =
      incomingRequestId && UUID_PATTERN.test(incomingRequestId)
        ? incomingRequestId
        : randomUUID();

    (request as RequestWithId).requestId = requestId;
    response.setHeader("X-Request-ID", requestId);

    const tracer = trace.getTracer(TRACER_NAME);
    tracer.startActiveSpan(`HTTP ${request.method}`, (span) => {
      response.on("finish", () => {
        const durationNanoseconds = process.hrtime.bigint() - startedAt;
        const durationMs = Number(durationNanoseconds) / 1_000_000;
        const template = routeTemplate(request);
        const isHealthCheck = template.startsWith(HEALTH_ROUTE_PREFIX);

        span.updateName(`${request.method} ${template}`);
        span.setAttribute("http.route", template);
        span.setAttribute("http.status_code", response.statusCode);
        if (response.statusCode >= 500) {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        span.end();

        this.metrics.recordHttpRequest(
          template,
          response.statusCode,
          durationMs,
        );

        // A successful health-check poll would otherwise dominate production
        // logs; failures still need to be visible.
        if (isHealthCheck && response.statusCode < 400) {
          return;
        }

        this.logger.log({
          message: "HTTP request completed",
          event: "http_request_completed",
          requestId,
          method: request.method,
          path: request.originalUrl.split("?")[0],
          statusCode: response.statusCode,
          durationMs,
        });
      });

      next();
    });
  }
}
