import { OpenFeature, TypedInMemoryProvider } from "@openfeature/server-sdk";

import { FeatureFlagsService } from "../feature-flags/feature-flags.service";
import { LocalStaticFeatureProvider } from "../feature-flags/local-static-feature-provider";
import {
  AdvertisingPolicyService,
  NoOpAdvertisingProvider,
} from "./advertising-policy.service";

class FailingProvider extends TypedInMemoryProvider {
  override resolveBooleanEvaluation(): Promise<never> {
    return Promise.reject(new Error("provider unavailable"));
  }
}

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

  it("stays fail-closed end-to-end when the underlying feature-flag provider is down, rather than rejecting", async () => {
    const flagsLogger = { warn: jest.fn() };
    const flags = new FeatureFlagsService(
      flagsLogger as never,
      new LocalStaticFeatureProvider(),
    );
    await flags.onModuleInit();
    try {
      await OpenFeature.setProviderAndWait(new FailingProvider());
      const outageService = new AdvertisingPolicyService(
        flags,
        new NoOpAdvertisingProvider(),
      );

      await expect(
        outageService.snapshot(context, new Date("2026-01-01T00:00:00Z")),
      ).resolves.toMatchObject({ enabled: false, mode: "DISABLED" });
      await expect(
        outageService.eligibility("home.bottom_banner", context),
      ).resolves.toEqual({
        placement: "home.bottom_banner",
        eligible: false,
        reason: "ADVERTISING_DISABLED",
      });
    } finally {
      await OpenFeature.setProviderAndWait(new LocalStaticFeatureProvider());
      await flags.onModuleDestroy();
    }
  });
});
