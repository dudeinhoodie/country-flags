import { createHmac } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { EnvironmentVariables } from "../../config/environment.validation";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { ApiException } from "../http/api.exception";

interface CounterRow {
  request_count: number;
  window_started_at: Date;
}

/**
 * Postgres-backed fixed-window limiter shared across every module that needs to bound
 * request frequency (auth, account lifecycle, reviews, sync, analytics, diagnostics).
 * Not tied to auth specifically — `scope` namespaces callers, `clientKey` is whatever
 * identity (user ID, IP) the caller wants to bucket by. Backed by a single Postgres
 * table rather than in-memory state so limits hold across multiple app instances.
 */
@Injectable()
export class RateLimiter {
  private static readonly WINDOW_SECONDS = 60;

  constructor(
    private readonly database: PrismaService,
    private readonly config: ConfigService<EnvironmentVariables>,
  ) {}

  async consume(
    scope: string,
    clientKey: string,
    limit: number,
  ): Promise<void> {
    const now = new Date();
    const windowStart = new Date(
      now.getTime() - RateLimiter.WINDOW_SECONDS * 1_000,
    );
    const keyHash = createHmac(
      "sha256",
      this.config.getOrThrow<string>("AUTH_RATE_LIMIT_SECRET"),
    )
      .update(`${scope}:${clientKey}`)
      .digest("hex");
    const rows = await this.database.$queryRaw<CounterRow[]>`
      INSERT INTO auth_rate_limit_buckets (
        key_hash, scope, window_started_at, request_count, updated_at
      )
      VALUES (${keyHash}, ${scope}, ${now}, 1, ${now})
      ON CONFLICT (key_hash) DO UPDATE SET
        request_count = CASE
          WHEN auth_rate_limit_buckets.window_started_at <= ${windowStart}
            THEN 1
          ELSE auth_rate_limit_buckets.request_count + 1
        END,
        window_started_at = CASE
          WHEN auth_rate_limit_buckets.window_started_at <= ${windowStart}
            THEN ${now}
          ELSE auth_rate_limit_buckets.window_started_at
        END,
        updated_at = ${now}
      RETURNING request_count, window_started_at
    `;
    const counter = rows[0];
    if (counter !== undefined && counter.request_count > limit) {
      const retryAfter = Math.max(
        1,
        Math.ceil(
          (counter.window_started_at.getTime() +
            RateLimiter.WINDOW_SECONDS * 1_000 -
            now.getTime()) /
            1_000,
        ),
      );
      throw new ApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        "RATE_LIMIT_EXCEEDED",
        "Too many requests",
        { retryAfter },
      );
    }
  }
}
