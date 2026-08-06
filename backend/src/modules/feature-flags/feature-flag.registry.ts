import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type FeatureFlagValue = boolean | number | string;
export type FeatureFlagType = "boolean" | "number" | "string";
export type ActivationPolicy = "immediate" | "nextLaunch" | "nextSession";

export interface FeatureFlagDefinition {
  key: string;
  type: FeatureFlagType;
  defaultValue: FeatureFlagValue;
  activationPolicy: ActivationPolicy;
  serverEnforced: boolean;
  clientVisible: boolean;
  allowedValues?: string[];
  minimum?: number;
  maximum?: number;
}

interface FeatureFlagRegistryDocument {
  schemaVersion: number;
  flags: FeatureFlagDefinition[];
}

function registryPath(): string {
  return resolve(
    __dirname,
    "../../../../contracts/registries/feature-flags.json",
  );
}

function assertDefinition(definition: FeatureFlagDefinition): void {
  if (
    !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,}$/u.test(definition.key) ||
    typeof definition.defaultValue !== definition.type ||
    !["immediate", "nextLaunch", "nextSession"].includes(
      definition.activationPolicy,
    )
  ) {
    throw new Error(
      `Feature flag registry has invalid entry ${definition.key}`,
    );
  }
  if (
    definition.type === "string" &&
    definition.allowedValues !== undefined &&
    !definition.allowedValues.includes(definition.defaultValue as string)
  ) {
    throw new Error(
      `Feature flag ${definition.key} default is not an allowed string value`,
    );
  }
  if (
    definition.type === "number" &&
    ((definition.minimum !== undefined &&
      (definition.defaultValue as number) < definition.minimum) ||
      (definition.maximum !== undefined &&
        (definition.defaultValue as number) > definition.maximum))
  ) {
    throw new Error(`Feature flag ${definition.key} default is out of bounds`);
  }
}

function loadRegistry(): FeatureFlagRegistryDocument {
  const parsed = JSON.parse(readFileSync(registryPath(), "utf8")) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("schemaVersion" in parsed) ||
    parsed.schemaVersion !== 1 ||
    !("flags" in parsed) ||
    !Array.isArray(parsed.flags)
  ) {
    throw new Error("Feature flag registry must use schema version 1");
  }
  const flags = parsed.flags as FeatureFlagDefinition[];
  const keys = new Set<string>();
  for (const definition of flags) {
    assertDefinition(definition);
    if (keys.has(definition.key)) {
      throw new Error(
        `Feature flag registry has duplicate key ${definition.key}`,
      );
    }
    keys.add(definition.key);
  }
  return { schemaVersion: 1, flags };
}

const registry = loadRegistry();

export const FEATURE_FLAGS = new Map(
  registry.flags.map((definition) => [definition.key, definition]),
);
export const FEATURE_FLAGS_VERSION = createHash("sha256")
  .update(JSON.stringify(registry))
  .digest("hex");

export function getFeatureFlag(key: string): FeatureFlagDefinition {
  const definition = FEATURE_FLAGS.get(key);
  if (definition === undefined) {
    throw new Error(`Unknown feature flag ${key}`);
  }
  return definition;
}
