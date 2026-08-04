import type { FeatureFlagsService } from "../feature-flags/feature-flags.service";
import {
  AdvertisingPolicyService,
  NoOpAdvertisingProvider,
} from "./advertising-policy.service";

const context = {
  platform: "ios" as const,
  appVersion: "1.0.0",
  locale: "en",
};

describe("AdvertisingPolicyService", () => {
  const flags: Pick<FeatureFlagsService, "evaluate"> = {
    evaluate: () =>
      Promise.resolve({
        type: "boolean",
        value: true,
        variant: "enabled-by-test",
        activationPolicy: "immediate",
      }),
  };
  const service = new AdvertisingPolicyService(
    flags as FeatureFlagsService,
    new NoOpAdvertisingProvider(),
  );

  it("remains default-off even when a provider reports every kill switch enabled", async () => {
    await expect(
      service.snapshot(context, new Date("2026-01-01T00:00:00Z")),
    ).resolves.toMatchObject({
      enabled: false,
      mode: "DISABLED",
      placements: {
        "home.bottom_banner": { enabled: false, format: "BANNER" },
      },
    });
  });

  it("returns a fail-closed eligibility decision without an advertising SDK", async () => {
    await expect(
      service.eligibility("home.bottom_banner", context),
    ).resolves.toEqual({
      placement: "home.bottom_banner",
      eligible: false,
      reason: "ADVERTISING_DISABLED",
    });
  });
});
