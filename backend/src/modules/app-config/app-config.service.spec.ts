import type { AdvertisingPolicyService } from "../advertising/advertising-policy.service";
import type { FeatureFlagsService } from "../feature-flags/feature-flags.service";
import type { PrismaService } from "../../infrastructure/database/prisma.service";
import {
  AppConfigService,
  SNAPSHOT_CACHE_MAX_ENTRIES,
} from "./app-config.service";

function serviceWithCounters(): {
  service: AppConfigService;
  evaluations: () => number;
} {
  const clientSnapshot = jest.fn().mockResolvedValue({});
  const database = {
    contentPointer: {
      findUnique: jest.fn().mockResolvedValue({ contentVersion: "2026.09.1" }),
    },
  } as unknown as PrismaService;
  const flags = { clientSnapshot } as unknown as FeatureFlagsService;
  const advertising = {
    snapshot: jest.fn().mockResolvedValue({ enabled: false }),
  } as unknown as AdvertisingPolicyService;
  return {
    service: new AppConfigService(database, flags, advertising),
    evaluations: () => clientSnapshot.mock.calls.length,
  };
}

function request(appVersion: string): {
  platform: "ios";
  appVersion: string;
  locale: string;
} {
  return { platform: "ios", appVersion, locale: "en" };
}

describe("AppConfigService snapshot cache", () => {
  it("serves a repeated context from the cache", async () => {
    const { service, evaluations } = serviceWithCounters();

    const first = await service.snapshot(request("1.0.0"));
    const second = await service.snapshot(request("1.0.0"));

    expect(second).toBe(first);
    expect(evaluations()).toBe(1);
  });

  it("keeps at most the configured number of snapshots", async () => {
    const { service, evaluations } = serviceWithCounters();

    for (let index = 0; index <= SNAPSHOT_CACHE_MAX_ENTRIES; index += 1) {
      await service.snapshot(request(`1.0.${index}`));
    }
    expect(evaluations()).toBe(SNAPSHOT_CACHE_MAX_ENTRIES + 1);

    // The first context was the least recently used one, so it was evicted
    // when the limit was crossed and has to be evaluated again.
    await service.snapshot(request("1.0.0"));
    expect(evaluations()).toBe(SNAPSHOT_CACHE_MAX_ENTRIES + 2);
  });

  it("evicts the least recently used snapshot, not the oldest one", async () => {
    const { service, evaluations } = serviceWithCounters();

    await service.snapshot(request("1.0.0"));
    for (let index = 1; index < SNAPSHOT_CACHE_MAX_ENTRIES; index += 1) {
      await service.snapshot(request(`1.0.${index}`));
    }
    // Touch the first entry so that 1.0.1 becomes the least recently used.
    await service.snapshot(request("1.0.0"));
    await service.snapshot(request("2.0.0"));
    const beforeReads = evaluations();

    await service.snapshot(request("1.0.0"));
    expect(evaluations()).toBe(beforeReads);
    await service.snapshot(request("1.0.1"));
    expect(evaluations()).toBe(beforeReads + 1);
  });

  it("re-evaluates an expired snapshot", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-24T10:00:00.000Z") });
    try {
      const { service, evaluations } = serviceWithCounters();

      await service.snapshot(request("1.0.0"));
      jest.setSystemTime(new Date("2026-09-24T10:06:00.000Z"));
      await service.snapshot(request("1.0.0"));

      expect(evaluations()).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
