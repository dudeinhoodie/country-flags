import { randomUUID } from "node:crypto";

import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { JsonLoggerService } from "../logging/json-logger.service";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RequestWithId extends Request {
  requestId: string;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly logger: JsonLoggerService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    const incomingRequestId = request.header("x-request-id");
    const requestId =
      incomingRequestId && UUID_PATTERN.test(incomingRequestId)
        ? incomingRequestId
        : randomUUID();

    (request as RequestWithId).requestId = requestId;
    response.setHeader("X-Request-ID", requestId);

    response.on("finish", () => {
      const durationNanoseconds = process.hrtime.bigint() - startedAt;

      this.logger.log({
        message: "HTTP request completed",
        event: "http_request_completed",
        requestId,
        method: request.method,
        path: request.originalUrl.split("?")[0],
        statusCode: response.statusCode,
        durationMs: Number(durationNanoseconds) / 1_000_000,
      });
    });

    next();
  }
}
