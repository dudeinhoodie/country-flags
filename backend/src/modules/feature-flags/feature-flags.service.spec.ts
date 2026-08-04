import { OpenFeature, TypedInMemoryProvider } from "@openfeature/server-sdk";

import { ApiException } from "../../common/http/api.exception";
import { LocalStaticFeatureProvider } from "./local-static-feature-provider";
import { FeatureFlagsService } from "./feature-flags.service";

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

describe("FeatureFlagsService", () => {
  const logger = { warn: jest.fn() };
  let service: FeatureFlagsService;

  beforeAll(async () => {
    service = new FeatureFlagsService(
      logger as never,
      new LocalStaticFeatureProvider(),
    );
    await service.onModuleInit();
  });

  afterAll(async () => {
    await service.onModuleDestroy();
  });

  it("uses typed registry defaults and exposes only client-visible flags", async () => {
    await expect(
      service.evaluate("study.max_new_cards_per_session", context),
    ).resolves.toMatchObject({ type: "number", value: 10 });
    await expect(service.clientSnapshot(context)).resolves.toMatchObject({
      "study.review_submission.enabled": {
        type: "boolean",
        value: true,
      },
      "ads.enabled": { type: "boolean", value: false },
    });
  });

  it("returns the typed caller fallback for unknown flags", async () => {
    await expect(
      service.getBoolean("unknown.flag.enabled", false, context),
    ).resolves.toBe(false);
  });

  it("provides a fail-closed guard for server-enforced capabilities", async () => {
    await expect(
      service.requireBoolean("ads.enabled", context),
    ).rejects.toThrow(ApiException);
  });

  it("falls back to a registry default when the provider is unavailable", async () => {
    await OpenFeature.setProviderAndWait(new FailingProvider());
    await expect(
      service.evaluate("ads.enabled", context),
    ).resolves.toMatchObject({ value: false, variant: "default" });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "feature_flag_default_used" }),
    );
    await OpenFeature.setProviderAndWait(new LocalStaticFeatureProvider());
  });
});
