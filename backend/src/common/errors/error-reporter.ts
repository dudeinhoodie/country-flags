import { Injectable } from "@nestjs/common";

import { JsonLoggerService } from "../logging/json-logger.service";

export interface ErrorReportContext {
  requestId?: string;
  traceId?: string;
  tags?: Record<string, string>;
  breadcrumbs?: string[];
}

/** Provider-neutral crash/error reporting boundary — a real provider adapter can replace NoOp later without touching call sites. */
export interface ErrorReporter {
  report(error: Error, context: ErrorReportContext): void;
}

export const ERROR_REPORTER = Symbol("ERROR_REPORTER");

@Injectable()
export class NoOpErrorReporter implements ErrorReporter {
  constructor(private readonly logger: JsonLoggerService) {}

  report(error: Error, context: ErrorReportContext): void {
    this.logger.error(
      {
        message: error.message,
        event: "unexpected_error_reported",
        errorClass: error.constructor.name,
        ...context,
      },
      error.stack,
    );
  }
}
