import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { Response } from "express";

import type { RequestWithId } from "../../common/http/request-id.middleware";

@Catch(HttpException)
export class ContentHttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<Response>();
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
      response.status(status).json({
        ...exceptionResponse,
        error: {
          ...exceptionResponse.error,
          requestId: request.requestId,
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
    const codeByStatus: Record<number, string> = {
      400: "VALIDATION_FAILED",
      401: "UNAUTHORIZED",
      404: "RESOURCE_NOT_FOUND",
      409: "IDEMPOTENCY_CONFLICT",
      429: "RATE_LIMIT_EXCEEDED",
      422: "VALIDATION_FAILED",
      503: "SERVICE_UNAVAILABLE",
    };
    const code = codeByStatus[status] ?? "REQUEST_FAILED";

    response.status(status).json({
      error: {
        code,
        message,
        requestId: request.requestId,
        details: {},
      },
    });
  }
}
