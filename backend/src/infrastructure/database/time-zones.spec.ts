import { FALLBACK_TIME_ZONE, TimeZoneCatalog } from "./time-zones";

/** A database whose `pg_timezone_names` holds these names. */
function databaseKnowing(names: string[]): {
  database: { $queryRaw: jest.Mock };
  reads: () => number;
} {
  const $queryRaw = jest
    .fn()
    .mockResolvedValue(names.map((name) => ({ name })));
  return { database: { $queryRaw }, reads: () => $queryRaw.mock.calls.length };
}

describe("TimeZoneCatalog", () => {
  it("answers in PostgreSQL's spelling, whatever the case asked in", async () => {
    const { database } = databaseKnowing(["Europe/Moscow", "UTC"]);
    const catalog = new TimeZoneCatalog();

    await expect(catalog.lookUp(database, "europe/moscow")).resolves.toBe(
      "Europe/Moscow",
    );
    await expect(catalog.lookUp(database, "Europe/Moscow")).resolves.toBe(
      "Europe/Moscow",
    );
  });

  // Intl takes offsets and PostgreSQL reads them with the sign inverted;
  // neither they nor a name it has never heard of may reach AT TIME ZONE.
  it.each(["+05:30", "Mars/Olympus_Mons", ""])(
    "does not know %p",
    async (name) => {
      const { database } = databaseKnowing(["Europe/Moscow", "UTC"]);
      await expect(
        new TimeZoneCatalog().lookUp(database, name),
      ).resolves.toBeNull();
    },
  );

  // pg_timezone_names reads the whole zone database on every call.
  it("reads the list once", async () => {
    const { database, reads } = databaseKnowing(["Europe/Moscow", "UTC"]);
    const catalog = new TimeZoneCatalog();

    await Promise.all([
      catalog.lookUp(database, "Europe/Moscow"),
      catalog.lookUp(database, "Asia/Tokyo"),
    ]);
    await catalog.effective(database, "Europe/Berlin");

    expect(reads()).toBe(1);
  });

  it("tries again after a read that failed", async () => {
    const $queryRaw = jest
      .fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValue([{ name: "Europe/Moscow" }]);
    const catalog = new TimeZoneCatalog();

    await expect(
      catalog.lookUp({ $queryRaw }, "Europe/Moscow"),
    ).rejects.toThrow("connection reset");
    await expect(catalog.lookUp({ $queryRaw }, "Europe/Moscow")).resolves.toBe(
      "Europe/Moscow",
    );
    expect($queryRaw).toHaveBeenCalledTimes(2);
  });

  describe("the zone a day is counted in", () => {
    it("is the stored zone when PostgreSQL knows it", async () => {
      const { database } = databaseKnowing(["Asia/Tokyo", "UTC"]);
      await expect(
        new TimeZoneCatalog().effective(database, "asia/tokyo"),
      ).resolves.toBe("Asia/Tokyo");
    });

    // A bad stored value used to fail the statement, and with it every
    // rebuild of that learner's progress.
    it("is UTC when PostgreSQL does not know the stored zone", async () => {
      const { database } = databaseKnowing(["Asia/Tokyo", "UTC"]);
      await expect(
        new TimeZoneCatalog().effective(database, "Mars/Olympus_Mons"),
      ).resolves.toBe(FALLBACK_TIME_ZONE);
    });

    it("needs no lookup for the default", async () => {
      const { database, reads } = databaseKnowing([]);
      await expect(
        new TimeZoneCatalog().effective(database, "UTC"),
      ).resolves.toBe("UTC");
      expect(reads()).toBe(0);
    });
  });
});
