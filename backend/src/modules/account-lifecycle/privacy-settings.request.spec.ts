import { ApiException } from "../../common/http/api.exception";
import {
  parsePrivacySettingsVersion,
  parseUpdatePrivacySettingsRequest,
} from "./privacy-settings.request";

describe("privacy settings request validation", () => {
  it("accepts a partial, valid update", () => {
    expect(
      parseUpdatePrivacySettingsRequest({ productAnalyticsStatus: "DENIED" }),
    ).toEqual({ productAnalyticsStatus: "DENIED" });
  });

  it("rejects an unregistered consent status value", () => {
    expect(() =>
      parseUpdatePrivacySettingsRequest({ productAnalyticsStatus: "MAYBE" }),
    ).toThrow(ApiException);
  });

  it("rejects an empty body", () => {
    expect(() => parseUpdatePrivacySettingsRequest({})).toThrow(ApiException);
  });

  it("rejects unknown fields", () => {
    expect(() =>
      parseUpdatePrivacySettingsRequest({ unexpected: true }),
    ).toThrow(ApiException);
  });

  it("requires a weak integer ETag", () => {
    expect(parsePrivacySettingsVersion('W/"1"')).toBe(1);
    expect(() => parsePrivacySettingsVersion('"1"')).toThrow(ApiException);
    expect(() => parsePrivacySettingsVersion(undefined)).toThrow(ApiException);
  });
});
