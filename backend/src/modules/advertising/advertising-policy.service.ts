import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Inject, Injectable } from "@nestjs/common";

import {
  FeatureFlagsService,
  type FeatureFlagContext,
} from "../feature-flags/feature-flags.service";

type AdFormat = "BANNER" | "INTERSTITIAL" | "NATIVE" | "REWARDED";

interface Placement {
  key: string;
  format: AdFormat;
  defaultEnabled: false;
  approvedForRelease: false;
  featureFlag: string;
}

interface PlacementRegistry {
  schemaVersion: 1;
  placements: Placement[];
}

export type AdvertisingEligibilityReason =
  | "ADVERTISING_DISABLED"
  | "PLACEMENT_DISABLED"
  | "UNKNOWN_PLACEMENT"
  | "PROVIDER_UNAVAILABLE";

export interface AdvertisingEligibility {
  placement: string;
  eligible: false;
  reason: AdvertisingEligibilityReason;
}

/** Provider boundary: MVP intentionally has no advertising SDK or network calls. */
export interface AdvertisingProvider {
  isAvailable(): boolean;
}

export const ADVERTISING_PROVIDER = Symbol("ADVERTISING_PROVIDER");

@Injectable()
export class NoOpAdvertisingProvider implements AdvertisingProvider {
  isAvailable(): boolean {
    return false;
  }
}

function loadPlacements(): PlacementRegistry {
  const path = resolve(
    __dirname,
    "../../../../contracts/registries/ad-placements.json",
  );
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("schemaVersion" in parsed) ||
    parsed.schemaVersion !== 1 ||
    !("placements" in parsed) ||
    !Array.isArray(parsed.placements)
  ) {
    throw new Error("Advertising placement registry must use schema version 1");
  }
  const placements = parsed.placements as Placement[];
  const keys = new Set<string>();
  for (const placement of placements) {
    if (
      keys.has(placement.key) ||
      placement.defaultEnabled !== false ||
      placement.approvedForRelease !== false ||
      !placement.featureFlag.startsWith("ads.")
    ) {
      throw new Error(
        `Advertising placement registry is invalid at ${placement.key}`,
      );
    }
    keys.add(placement.key);
  }
  return { schemaVersion: 1, placements };
}

const placements = loadPlacements();
export const ADVERTISING_POLICY_VERSION = createHash("sha256")
  .update(JSON.stringify(placements))
  .digest("hex");

export interface AdvertisingPolicy {
  policyVersion: string;
  enabled: boolean;
  mode: "CONTEXTUAL_ONLY" | "DISABLED";
  placements: Record<string, { enabled: boolean; format: AdFormat }>;
  refreshAfter: string;
}

@Injectable()
export class AdvertisingPolicyService {
  constructor(
    private readonly flags: FeatureFlagsService,
    @Inject(ADVERTISING_PROVIDER)
    private readonly provider: AdvertisingProvider,
  ) {}

  async snapshot(
    context: FeatureFlagContext,
    refreshAfter: Date,
  ): Promise<AdvertisingPolicy> {
    const global = await this.flags.evaluate("ads.enabled", context);
    const entries = await Promise.all(
      placements.placements.map(async (placement) => {
        const evaluated = await this.flags.evaluate(
          placement.featureFlag,
          context,
        );
        // No provider or placement is approved for MVP; a flag cannot bypass policy.
        return [
          placement.key,
          {
            enabled:
              global.value === true &&
              evaluated.value === true &&
              placement.approvedForRelease,
            format: placement.format,
          },
        ] as const;
      }),
    );
    return {
      policyVersion: `ads-${ADVERTISING_POLICY_VERSION.slice(0, 16)}`,
      enabled: false,
      mode: "DISABLED",
      placements: Object.fromEntries(entries),
      refreshAfter: refreshAfter.toISOString(),
    };
  }

  async eligibility(
    placementKey: string,
    context: FeatureFlagContext,
  ): Promise<AdvertisingEligibility> {
    const placement = placements.placements.find(
      ({ key }) => key === placementKey,
    );
    if (placement === undefined) {
      return {
        placement: placementKey,
        eligible: false,
        reason: "UNKNOWN_PLACEMENT",
      };
    }
    const policy = await this.snapshot(context, new Date());
    if (!policy.enabled) {
      return {
        placement: placement.key,
        eligible: false,
        reason: "ADVERTISING_DISABLED",
      };
    }
    if (!policy.placements[placement.key]?.enabled) {
      return {
        placement: placement.key,
        eligible: false,
        reason: "PLACEMENT_DISABLED",
      };
    }
    if (!this.provider.isAvailable()) {
      return {
        placement: placement.key,
        eligible: false,
        reason: "PROVIDER_UNAVAILABLE",
      };
    }
    // The interface is intentionally fail-closed until a release-approved provider exists.
    return {
      placement: placement.key,
      eligible: false,
      reason: "PLACEMENT_DISABLED",
    };
  }
}
