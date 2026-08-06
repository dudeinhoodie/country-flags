import { Injectable, type LoggerService } from "@nestjs/common";
import { trace } from "@opentelemetry/api";

import { redact } from "./redaction";

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  environment: string;
  release: string;
  message: string;
  context?: string;
  stack?: string;
  traceId?: string;
  spanId?: string;
  [key: string]: unknown;
}

const SERVICE_NAME = process.env.SERVICE_NAME ?? "country-flags-api";
const ENVIRONMENT = process.env.NODE_ENV ?? "development";
const RELEASE = process.env.SERVICE_RELEASE ?? "dev";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

@Injectable()
export class JsonLoggerService implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write("info", message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write("error", message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write("warn", message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write("debug", message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write("debug", message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write("fatal", message, optionalParams);
  }

  private write(
    level: LogLevel,
    message: unknown,
    optionalParams: unknown[],
  ): void {
    const structuredMessage = isRecord(message) ? message : undefined;
    const error = message instanceof Error ? message : undefined;
    const context = optionalParams.find(
      (parameter): parameter is string => typeof parameter === "string",
    );
    const stack = optionalParams.find(
      (parameter): parameter is string =>
        typeof parameter === "string" && parameter.includes("\n"),
    );
    const resolvedStack = error?.stack ?? stack;
    const spanContext = trace.getActiveSpan()?.spanContext();

    const entry: LogEntry = redact({
      timestamp: new Date().toISOString(),
      level,
      service: SERVICE_NAME,
      environment: ENVIRONMENT,
      release: RELEASE,
      message:
        typeof structuredMessage?.message === "string"
          ? structuredMessage.message
          : (error?.message ?? String(message)),
      ...(structuredMessage ?? {}),
      ...(context ? { context } : {}),
      ...(spanContext !== undefined
        ? { traceId: spanContext.traceId, spanId: spanContext.spanId }
        : {}),
    });
    // The stack trace is exempt from redaction (it belongs to a protected
    // error/log backend and carries no user-supplied field values), attached
    // after redaction so file paths and identifiers in it survive intact.
    if (resolvedStack !== undefined) {
      entry.stack = resolvedStack;
    }
    const target =
      level === "error" || level === "fatal" ? process.stderr : process.stdout;

    target.write(`${JSON.stringify(entry)}\n`);
  }
}
