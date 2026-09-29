import type { Prisma } from "@prisma/client";

/** Anything that can run a raw query: the client or an open transaction. */
export type Queryable = Pick<Prisma.TransactionClient, "$queryRaw">;

/**
 * The zone a learner's day is counted in when the stored one is unusable. It
 * is also the default of `user_settings.timezone`.
 */
export const FALLBACK_TIME_ZONE = "UTC";

/**
 * The time zone names PostgreSQL knows, the authority on which zone a stored
 * name may be.
 *
 * The learner's day is resolved by PostgreSQL (`AT TIME ZONE`), so a name only
 * JavaScript accepts is worse than useless: `Intl` takes `+05:30`, which
 * PostgreSQL reads as a POSIX offset with the sign inverted, and a name
 * PostgreSQL does not know at all fails the statement and, with it, every
 * rebuild of that learner's progress (#452).
 *
 * `pg_timezone_names` reads the whole zone database on every call, so the list
 * is read once per process and kept. It changes only with a PostgreSQL
 * upgrade, and a zone added by one is at worst refused until the next start.
 * Keys are lower-cased because PostgreSQL matches zone names without regard to
 * case; the value is the spelling PostgreSQL lists, which is what gets stored.
 */
export class TimeZoneCatalog {
  private names: Promise<ReadonlyMap<string, string>> | undefined;

  /** The name as PostgreSQL spells it, or `null` when PostgreSQL does not know it. */
  async lookUp(client: Queryable, name: string): Promise<string | null> {
    return (await this.load(client)).get(name.toLowerCase()) ?? null;
  }

  /**
   * The zone to count a learner's day in: the stored one when PostgreSQL
   * knows it, UTC otherwise. A bad stored value costs the learner an
   * accurate midnight, never the request.
   */
  async effective(client: Queryable, stored: string): Promise<string> {
    // The default, and by far the most common value, needs no lookup.
    if (stored === FALLBACK_TIME_ZONE) return stored;
    return (await this.lookUp(client, stored)) ?? FALLBACK_TIME_ZONE;
  }

  private load(client: Queryable): Promise<ReadonlyMap<string, string>> {
    if (this.names === undefined) {
      const loading = client.$queryRaw<Array<{ name: unknown }>>`
        SELECT name FROM pg_timezone_names
      `.then(
        (rows) =>
          new Map(
            rows
              .map(({ name }) => name)
              .filter((name): name is string => typeof name === "string")
              .map((name) => [name.toLowerCase(), name] as const),
          ),
      );
      this.names = loading;
      // A failed read is not kept: the next caller tries again.
      void loading.catch(() => {
        if (this.names === loading) this.names = undefined;
      });
    }
    return this.names;
  }
}

/** The process's one catalog, shared so the list is read once. */
export const timeZoneCatalog = new TimeZoneCatalog();
