import { Injectable, ServiceUnavailableException } from "@nestjs/common";

import { JsonLoggerService } from "../../common/logging/json-logger.service";
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
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: JsonLoggerService,
  ) {}

  getLiveness(): LivenessResponse {
    return { status: "ok" };
  }

  async getReadiness(): Promise<ReadinessResponse> {
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
}
