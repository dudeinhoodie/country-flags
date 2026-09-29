import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/** Prisma's own wait for a pooled connection when the URL names none. */
const DEFAULT_POOL_TIMEOUT_SECONDS = 10;

/**
 * How long an interactive transaction may wait for a connection: exactly as
 * long as a single query may, which is the pooled URL's `pool_timeout`.
 *
 * The two waits are separate in Prisma. A query waits `pool_timeout` (ten
 * seconds unless the URL says otherwise) and then fails with P2024; a
 * transaction waits `maxWait`, two seconds by default and blind to the URL,
 * and then fails with P2028. The deploy sizes the pool and its timeout in the
 * URL (#437), but the transactions never saw that timeout: at a peak they
 * gave up in two seconds while plain queries were still queueing, and the
 * progress reads — transactions, requested three at a time by every syncing
 * app — failed first (#452).
 *
 * A call that passes its own `maxWait` still gets it.
 */
export function transactionMaxWaitMs(databaseUrl: string | undefined): number {
  let poolTimeout: string | null = null;
  try {
    poolTimeout =
      databaseUrl === undefined
        ? null
        : new URL(databaseUrl).searchParams.get("pool_timeout");
  } catch {
    // An unreadable URL is environment validation's to refuse, not this.
  }
  const seconds =
    poolTimeout !== null && /^[1-9][0-9]*$/.test(poolTimeout)
      ? Number(poolTimeout)
      : DEFAULT_POOL_TIMEOUT_SECONDS;
  return seconds * 1_000;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnApplicationShutdown
{
  constructor() {
    super({
      transactionOptions: {
        maxWait: transactionMaxWaitMs(process.env.DATABASE_URL),
      },
    });
  }

  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
