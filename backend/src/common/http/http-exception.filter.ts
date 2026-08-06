import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
} from "@nestjs/common";
import { trace } from "@opentelemetry/api";
import type { Response } from "express";

import { ERROR_REPORTER, type ErrorReporter } from "../errors/error-reporter";
import { MetricsService } from "../telemetry/metrics.service";
import type { RequestWithId } from "./request-id.middleware";

const CODE_BY_STATUS: Record<number, string> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHORIZED",
  404: "RESOURCE_NOT_FOUND",
  409: "IDEMPOTENCY_CONFLICT",
  413: "BODY_TOO_LARGE",
  422: "VALIDATION_FAILED",
  429: "RATE_LIMIT_EXCEEDED",
  503: "SERVICE_UNAVAILABLE",
};

/**
 * body-parser (invoked by Nest's body parsing middleware before a controller — or our own
 * HttpException handling — ever runs) throws plain `http-errors`-shaped objects for things
 * like an oversized or malformed body, not `HttpException` instances. Without this check
 * those errors fall through to the 500/unexpected path and get sent to the ErrorReporter
 * as if they were application bugs, even though they're ordinary client mistakes.
 */
function clientHttpErrorStatus(exception: unknown): number | undefined {
  if (typeof exception !== "object" || exception === null) {
    return undefined;
  }
  const candidate = exception as { status?: unknown; statusCode?: unknown };
  const status = candidate.status ?? candidate.statusCode;
  return typeof status === "number" && status >= 400 && status < 500
    ? status
    : undefined;
}

/**
 * Every thrown exception passes through here. A deliberately-thrown
 * `HttpException` (validation, auth, conflict, a controlled 503 — anything
 * the application already modeled as a typed outcome) is "expected": it is
 * not sent to the ErrorReporter and its own message/code reach the client
 * unchanged. Anything else is an uncaught defect or infrastructure failure —
 * "unexpected" — reported to the ErrorReporter and never exposes its raw
 * message to the client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(
    @Inject(ERROR_REPORTER) private readonly errorReporter: ErrorReporter,
    private readonly metrics: MetricsService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<Response>();
    const traceId = trace.getActiveSpan()?.spanContext().traceId;
    const clientErrorStatus = clientHttpErrorStatus(exception);
    const expected = exception instanceof HttpException;

    if (!expected && clientErrorStatus === undefined) {
      const error =
        exception instanceof Error ? exception : new Error(String(exception));
      this.errorReporter.report(error, {
        requestId: request.requestId,
        ...(traceId !== undefined ? { traceId } : {}),
        tags: {
          method: request.method,
          path: request.originalUrl.split("?")[0] ?? request.path,
        },
      });
    }

    if (expected) {
      this.respondExpected(exception, request, response, traceId);
      return;
    }
    if (clientErrorStatus !== undefined) {
      this.respondClientError(
        clientErrorStatus,
        exception,
        request,
        response,
        traceId,
      );
      return;
    }
    this.respondUnexpected(request, response, traceId);
  }

  private respondExpected(
    exception: HttpException,
    request: RequestWithId,
    response: Response,
    traceId: string | undefined,
  ): void {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    if (
      typeof exceptionResponse === "object" &&
      exceptionResponse !== null &&
      "error" in exceptionResponse &&
      typeof exceptionResponse.error === "object" &&
      exceptionResponse.error !== null
    ) {
      if (
        status === 429 &&
        "details" in exceptionResponse.error &&
        typeof exceptionResponse.error.details === "object" &&
        exceptionResponse.error.details !== null &&
        "retryAfter" in exceptionResponse.error.details &&
        typeof exceptionResponse.error.details.retryAfter === "number"
      ) {
        response.setHeader(
          "Retry-After",
          String(exceptionResponse.error.details.retryAfter),
        );
      }
      const errorBody = exceptionResponse.error as Record<string, unknown>;
      this.metrics.recordError(
        typeof errorBody.code === "string" ? errorBody.code : "REQUEST_FAILED",
      );
      response.status(status).json({
        ...exceptionResponse,
        error: {
          ...exceptionResponse.error,
          requestId: request.requestId,
          ...(traceId !== undefined ? { traceId } : {}),
        },
      });
      return;
    }

    const rawMessage =
      typeof exceptionResponse === "string"
        ? exceptionResponse
        : typeof exceptionResponse === "object" &&
            exceptionResponse !== null &&
            "message" in exceptionResponse
          ? exceptionResponse.message
          : exception.message;
    const message = Array.isArray(rawMessage)
      ? rawMessage.join("; ")
      : String(rawMessage);
    const code = CODE_BY_STATUS[status] ?? "REQUEST_FAILED";

    this.metrics.recordError(code);
    response.status(status).json({
      error: {
        code,
        message,
        requestId: request.requestId,
        ...(traceId !== undefined ? { traceId } : {}),
        details: {},
      },
    });
  }

  private respondClientError(
    status: number,
    exception: unknown,
    request: RequestWithId,
    response: Response,
    traceId: string | undefined,
  ): void {
    const code = CODE_BY_STATUS[status] ?? "REQUEST_FAILED";
    const message =
      exception instanceof Error
        ? exception.message
        : "The request could not be processed";

    this.metrics.recordError(code);
    response.status(status).json({
      error: {
        code,
        message,
        requestId: request.requestId,
        ...(traceId !== undefined ? { traceId } : {}),
        details: {},
      },
    });
  }

  private respondUnexpected(
    request: RequestWithId,
    response: Response,
    traceId: string | undefined,
  ): void {
    this.metrics.recordError("INTERNAL_ERROR");
    response.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        requestId: request.requestId,
        ...(traceId !== undefined ? { traceId } : {}),
        details: {},
      },
    });
  }
}
