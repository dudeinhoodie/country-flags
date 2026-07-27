import { Injectable, type LoggerService } from "@nestjs/common";

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: string;
  stack?: string;
  [key: string]: unknown;
}

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

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message:
        typeof structuredMessage?.message === "string"
          ? structuredMessage.message
          : (error?.message ?? String(message)),
      ...(structuredMessage ?? {}),
      ...(context ? { context } : {}),
      ...(resolvedStack ? { stack: resolvedStack } : {}),
    };
    const target =
      level === "error" || level === "fatal" ? process.stderr : process.stdout;

    target.write(`${JSON.stringify(entry)}\n`);
  }
}
