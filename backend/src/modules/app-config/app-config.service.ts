import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { AdvertisingPolicyService } from "../advertising/advertising-policy.service";
import { FEATURE_FLAGS_VERSION } from "../feature-flags/feature-flag.registry";
import {
  FeatureFlagsService,
  type FeatureFlagContext,
} from "../feature-flags/feature-flags.service";
import { PrismaService } from "../../infrastructure/database/prisma.service";

const SNAPSHOT_TTL_MS = 5 * 60 * 1_000;
/**
 * Upper bound on cached snapshots per process. The key space is platform x
 * version x locale x content version; real traffic uses a few dozen
 * combinations, and the least recently used entry goes first beyond this.
 */
export const SNAPSHOT_CACHE_MAX_ENTRIES = 500;

export type AppConfigRequest = FeatureFlagContext;

export interface AppConfigSnapshot {
  configVersion: string;
  generatedAt: string;
  expiresAt: string;
  minimumClientVersions: Record<
    "ios" | "android" | "web",
    { minimumSupported: string; latest: string; updateMode: "NONE" }
  >;
  contentVersion: string;
  supportedTemplateSchemaVersions: number[];
  featureFlags: Awaited<ReturnType<FeatureFlagsService["clientSnapshot"]>>;
  advertising: Awaited<ReturnType<AdvertisingPolicyService["snapshot"]>>;
}

@Injectable()
export class AppConfigService {
  private readonly snapshots = new Map<string, AppConfigSnapshot>();

  constructor(
    private readonly database: PrismaService,
    private readonly flags: FeatureFlagsService,
    private readonly advertising: AdvertisingPolicyService,
  ) {}

  async snapshot(request: AppConfigRequest): Promise<AppConfigSnapshot> {
    const pointer = await this.database.contentPointer.findUnique({
      where: { key: "active" },
      select: { contentVersion: true },
    });
    const contentVersion = pointer?.contentVersion ?? "unpublished";
    const cacheKey = [
      request.platform,
      request.appVersion,
      request.locale,
      request.accountId ?? "anonymous",
      contentVersion,
    ].join(":");
    const cached = this.snapshots.get(cacheKey);
    if (cached !== undefined) {
      // Re-inserting moves the entry to the end of the Map's insertion
      // order, which is what makes the first key the least recently used.
      this.snapshots.delete(cacheKey);
      if (new Date(cached.expiresAt) > new Date()) {
        this.snapshots.set(cacheKey, cached);
        return cached;
      }
    }
    const featureFlags = await this.flags.clientSnapshot(request);
    const generatedAt = new Date();
    const expiresAt = new Date(generatedAt.getTime() + SNAPSHOT_TTL_MS);
    const advertising = await this.advertising.snapshot(request, expiresAt);
    const configVersion = createHash("sha256")
      .update(
        JSON.stringify({
          registry: FEATURE_FLAGS_VERSION,
          contentVersion,
          featureFlags,
          advertising,
        }),
      )
      .digest("hex")
      .slice(0, 24);
    const snapshot: AppConfigSnapshot = {
      configVersion: `config-${configVersion}`,
      generatedAt: generatedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      minimumClientVersions: {
        ios: { minimumSupported: "1.0.0", latest: "1.0.0", updateMode: "NONE" },
        android: {
          minimumSupported: "1.0.0",
          latest: "1.0.0",
          updateMode: "NONE",
        },
        web: { minimumSupported: "1.0.0", latest: "1.0.0", updateMode: "NONE" },
      },
      contentVersion,
      supportedTemplateSchemaVersions: [1],
      featureFlags,
      advertising,
    };
    this.snapshots.set(cacheKey, snapshot);
    while (this.snapshots.size > SNAPSHOT_CACHE_MAX_ENTRIES) {
      const oldest = this.snapshots.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.snapshots.delete(oldest.value);
    }
    return snapshot;
  }
}
