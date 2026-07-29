import { ApiException } from "../../common/http/api.exception";
import {
  parseSettingsVersion,
  parseUpdateSettingsRequest,
} from "./settings.request";

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
});
