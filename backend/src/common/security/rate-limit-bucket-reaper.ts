import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { PrismaService } from "../../infrastructure/database/prisma.service";
import { JsonLoggerService } from "../logging/json-logger.service";

const SWEEP_INTERVAL_MS = 5 * 60 * 1_000;
const BUCKET_RETENTION_MS = 24 * 60 * 60 * 1_000;

/**
 * auth_rate_limit_buckets rows are only ever upserted, never deleted by RateLimiter
 * itself — without this sweep the table grows forever. A bucket is safe to drop once
 * it's well outside any window it could still be enforcing (windows are 60s; 24h is a
 * wide margin, not a retention policy claim — see docs/09-retention-and-backup.md).
 */
@Injectable()
export class RateLimitBucketReaper implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly database: PrismaService,
    private readonly logger: JsonLoggerService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
    }
  }

  async sweep(): Promise<number> {
    try {
      const result = await this.database.$executeRaw`
        DELETE FROM auth_rate_limit_buckets
        WHERE updated_at <= ${new Date(Date.now() - BUCKET_RETENTION_MS)}
      `;
      return Number(result);
    } catch (error) {
      this.logger.warn({
        message: "Rate limit bucket sweep failed",
        event: "rate_limit_bucket_sweep_failed",
        errorClass: error instanceof Error ? error.name : "UnknownError",
      });
      return 0;
    }
  }
}
