import { ApiException } from "../../common/http/api.exception";
import {
  parseSettingsVersion,
  parseUpdateSettingsRequest,
  withDatabaseTimeZone,
} from "./settings.request";

/** PostgreSQL's zone list, as far as these cases need it. */
const database = {
  $queryRaw: jest
    .fn()
    .mockResolvedValue([
      { name: "Europe/Moscow" },
      { name: "America/New_York" },
      { name: "UTC" },
    ]),
};

describe("settings request validation", () => {
  it.each([5, 10, 20])("accepts session size %s", (sessionSize) => {
    expect(parseUpdateSettingsRequest({ sessionSize })).toEqual({
      sessionSize,
    });
  });

  it.each([0, 15, 21, "10"])("rejects session size %p", (sessionSize) => {
    expect(() => parseUpdateSettingsRequest({ sessionSize })).toThrow(
      ApiException,
    );
  });

  it("canonicalizes locale, weekdays and fact order", () => {
    expect(
      parseUpdateSettingsRequest({
        contentLocale: "en-us",
        reminderWeekdays: [7, 1, 3],
        extraFactTypes: ["CURRENCY", "CAPITAL"],
      }),
    ).toEqual({
      contentLocale: "en-US",
      reminderWeekdays: [1, 3, 7],
      extraFactTypes: ["CAPITAL", "CURRENCY"],
    });
  });

  it("requires a weak integer ETag", () => {
    expect(parseSettingsVersion('W/"4"')).toBe(4);
    expect(() => parseSettingsVersion('"4"')).toThrow(ApiException);
    expect(() => parseSettingsVersion(undefined)).toThrow(ApiException);
  });

  describe("time zone", () => {
    it("takes a zone PostgreSQL knows, in PostgreSQL's spelling", async () => {
      await expect(
        withDatabaseTimeZone(
          database,
          parseUpdateSettingsRequest({ timezone: "europe/moscow" }),
        ),
      ).resolves.toEqual({ timezone: "Europe/Moscow" });
    });

    // Intl accepts an offset, and PostgreSQL would read it with the sign
    // inverted; the zone list is what decides.
    it("refuses an offset Intl accepts but PostgreSQL does not list", async () => {
      const parsed = parseUpdateSettingsRequest({ timezone: "+05:30" });

      await expect(
        withDatabaseTimeZone(database, parsed),
      ).rejects.toMatchObject({
        response: {
          error: {
            code: "VALIDATION_FAILED",
            details: {
              fields: [
                { field: "timezone", message: "must be an IANA time zone" },
              ],
            },
          },
        },
      });
    });

    it("refuses a name Intl does not know before asking PostgreSQL", () => {
      expect(() =>
        parseUpdateSettingsRequest({ timezone: "Mars/Olympus_Mons" }),
      ).toThrow(ApiException);
    });

    it("leaves an update without a zone as it is", async () => {
      const update = parseUpdateSettingsRequest({ sessionSize: 5 });
      await expect(withDatabaseTimeZone(database, update)).resolves.toBe(
        update,
      );
    });
  });
});
