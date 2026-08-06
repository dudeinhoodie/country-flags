import {
  type BeforeApplicationShutdown,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { JsonLoggerService } from "../../common/logging/json-logger.service";
import type { EnvironmentVariables } from "../../config/environment.validation";
import { PrismaService } from "../../infrastructure/database/prisma.service";

interface LivenessResponse {
  status: "ok";
}

interface ReadinessResponse {
  status: "ok";
  checks: {
    database: {
      status: "up";
      latencyMs: number;
    };
  };
}

@Injectable()
export class HealthService implements BeforeApplicationShutdown {
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: JsonLoggerService,
    private readonly config: ConfigService<EnvironmentVariables>,
  ) {}

  getLiveness(): LivenessResponse {
    return { status: "ok" };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    if (this.shuttingDown) {
      throw new ServiceUnavailableException({
        status: "error",
        checks: {
          database: {
            status: "down",
          },
        },
      });
    }

    const startedAt = process.hrtime.bigint();

    try {
      await this.prisma.ping();
    } catch {
      this.logger.warn({
        message: "Readiness database check failed",
        event: "readiness_check_failed",
        dependency: "postgresql",
      });

      throw new ServiceUnavailableException({
        status: "error",
        checks: {
          database: {
            status: "down",
          },
        },
      });
    }

    return {
      status: "ok",
      checks: {
        database: {
          status: "up",
          latencyMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        },
      },
    };
  }

  /**
   * Runs before the HTTP server stops accepting connections (see
   * `INestApplicationContext.close()`). On a manual `close()` — e2e test teardown,
   * most notably — `signal` is undefined and no drain is needed; the process isn't
   * actually terminating. On a real OS termination signal, mark readiness as failing
   * first so a load balancer has `SHUTDOWN_DRAIN_MS` to notice and stop routing new
   * traffic before the server actually closes.
   */
  async beforeApplicationShutdown(signal?: string): Promise<void> {
    if (signal === undefined) {
      return;
    }
    this.shuttingDown = true;
    const drainMs = this.config.get<number>("SHUTDOWN_DRAIN_MS") ?? 0;
    this.logger.log({
      message: "Shutdown signal received, draining readiness before close",
      event: "application_shutdown_draining",
      signal,
      drainMs,
    });
    if (drainMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, drainMs));
    }
  }
}
