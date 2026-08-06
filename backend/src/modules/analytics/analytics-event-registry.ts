import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

export type EventCategory = "product" | "operational";
export type EventConsentCategory = "product_analytics" | "essential_operations";
export type PropertyType = "string" | "integer" | "number" | "boolean";

export interface PropertyDefinition {
  type: PropertyType;
  required: boolean;
  enumValues?: string[];
}

export interface EventDefinition {
  name: string;
  schemaVersion: number;
  owner: string;
  purpose: string;
  category: EventCategory;
  consentCategory: EventConsentCategory;
  retentionClass: string;
  properties: Record<string, PropertyDefinition>;
}

interface RegistryDocument {
  schemaVersion: number;
  events: EventDefinition[];
}

function repositoryRoot(): string {
  return resolve(__dirname, "../../../..");
}

function loadRegistryDocument(): RegistryDocument {
  const root = repositoryRoot();
  const schema = JSON.parse(
    readFileSync(
      resolve(
        root,
        "contracts/schemas/analytics/event-registry.v1.schema.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const document = JSON.parse(
    readFileSync(
      resolve(root, "contracts/registries/analytics-events.json"),
      "utf8",
    ),
  ) as unknown;

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(document)) {
    throw new Error(
      `Analytics event registry is invalid:\n${ajv.errorsText(validate.errors, { separator: "\n" })}`,
    );
  }

  return document as RegistryDocument;
}

function key(eventName: string, schemaVersion: number): string {
  return `${eventName}:${String(schemaVersion)}`;
}

/** Loaded once at module init; the registry is a committed, CI-validated contract artifact, not runtime data. */
export const ANALYTICS_EVENT_REGISTRY: Map<string, EventDefinition> = new Map(
  loadRegistryDocument().events.map((event) => [
    key(event.name, event.schemaVersion),
    event,
  ]),
);

export function findEventDefinition(
  eventName: string,
  schemaVersion: number,
): EventDefinition | undefined {
  return ANALYTICS_EVENT_REGISTRY.get(key(eventName, schemaVersion));
}
