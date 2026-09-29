import { transactionMaxWaitMs } from "./prisma.service";

describe("transactionMaxWaitMs", () => {
  // The pooled URL of a hosted deploy carries the pool's timeout; a
  // transaction waits for a connection as long as a query does.
  it("waits as long as the pooled URL's pool_timeout", () => {
    expect(
      transactionMaxWaitMs(
        "postgresql://user:password@pooler.example/db?sslmode=require&connection_limit=10&pool_timeout=20",
      ),
    ).toBe(20_000);
  });

  // Prisma's own default for a query, not its two seconds for a transaction.
  it.each([
    ["no pool_timeout", "postgresql://user:password@localhost:5432/db"],
    ["a zero pool_timeout", "postgresql://u:p@localhost/db?pool_timeout=0"],
    [
      "an unreadable pool_timeout",
      "postgresql://u:p@localhost/db?pool_timeout=soon",
    ],
    ["no URL", undefined],
    ["an unparseable URL", "not a url"],
  ])("waits ten seconds with %s", (_case, url) => {
    expect(transactionMaxWaitMs(url)).toBe(10_000);
  });
});
