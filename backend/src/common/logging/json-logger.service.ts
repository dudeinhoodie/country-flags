import { Injectable, type LoggerService } from "@nestjs/common";
import { trace } from "@opentelemetry/api";

import { readReleaseMetadata } from "../../config/release-metadata";
import { redact } from "./redaction";

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

/**
 * How the levels rank, so a threshold can be compared rather than matched.
 *
 * The gaps are deliberate: a level added between two of these needs a number,
 * not a renumbering of everything after it.
 */
const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

/**
 * The quietest line this process will write.
 *
 * Read from the environment rather than from `ConfigService` because this
 * logger is built before Nest is: it is handed to `NestFactory.create` so the
 * boot itself has somewhere to log, and a dependency on the container would
 * make the first lines of a failed start the ones nobody sees.
 *
 * An unreadable value falls back to `info` rather than throwing. Refusing it
 * is environment validation's job — it lists the accepted levels and stops the
 * boot — and a logger that threw here would replace that clear error with its
 * own, raised from inside the thing meant to report it.
 */
function configuredRank(): number {
  const configured = process.env.LOG_LEVEL;
  if (configured !== undefined && configured in LEVEL_RANK) {
    return LEVEL_RANK[configured as LogLevel];
  }
  return LEVEL_RANK.info;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  environment: string;
  release: string;
  deploymentId?: string;
  migrationVersion?: string;
  message: string;
  context?: string;
  stack?: string;
  traceId?: string;
  spanId?: string;
  [key: string]: unknown;
}

/**
 * The fields that make a log line attributable to one deployment. `environment`
 * is the deployment environment, not NODE_ENV: dev and prod both run the
 * production build, so NODE_ENV alone cannot tell one deployment's logs from the
 * other's. `deploymentId` and `migrationVersion` are omitted rather than
 * defaulted when the platform does not supply them, so a local log line keeps
 * its old shape and a hosted one is never labelled with a rollout or a schema
 * that does not exist.
 */
interface DeploymentFields {
  service: string;
  environment: string;
  release: string;
  deploymentId?: string;
  migrationVersion?: string;
}

function deploymentFields(): DeploymentFields {
  const metadata = readReleaseMetadata();
  return {
    service: metadata.service,
    environment: metadata.environment,
    release: metadata.release,
    ...(metadata.deploymentId !== undefined
      ? { deploymentId: metadata.deploymentId }
      : {}),
    ...(metadata.migrationVersion !== undefined
      ? { migrationVersion: metadata.migrationVersion }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

@Injectable()
export class JsonLoggerService implements LoggerService {
  // Read once, when the singleton is built: the process cannot change
  // deployment mid-flight, and re-reading `process.env` per line would only
  // make two lines from one revision capable of disagreeing.
  private readonly deployment = deploymentFields();
  // Read once, for the same reason: the threshold belongs to the revision, and
  // a value that changed mid-process would make two lines disagree about what
  // this deployment was asked to say.
  private readonly rank = configuredRank();

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
    // Below the threshold the line is not built at all: redaction and
    // JSON.stringify are the expensive half, and a debug line nobody asked for
    // should cost nothing to not write.
    if (LEVEL_RANK[level] < this.rank) {
      return;
    }
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
      ...this.deployment,
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
