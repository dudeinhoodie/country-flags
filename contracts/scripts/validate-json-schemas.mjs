import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const contractsRoot = fileURLToPath(new URL("..", import.meta.url));

const validationTargets = [
  {
    schema: "schemas/configuration/app-config.v1.schema.json",
    data: ["fixtures/configuration/app-config.valid.json"],
  },
  {
    schema: "schemas/configuration/feature-flag-registry.v1.schema.json",
    data: ["registries/feature-flags.json"],
  },
  {
    schema: "schemas/configuration/ad-placement-registry.v1.schema.json",
    data: ["registries/ad-placements.json"],
  },
  {
    schema: "schemas/content/manifest.v1.schema.json",
    data: ["fixtures/content/manifest.valid.json"],
  },
  {
    schema: "schemas/analytics/event-registry.v1.schema.json",
    data: ["registries/analytics-events.json"],
  },
  {
    schema: "schemas/analytics/batch.v1.schema.json",
    data: ["fixtures/analytics/batch.valid.json"],
  },
  {
    schema: "schemas/security/guest-import.v1.schema.json",
    data: ["fixtures/security/guest-import.valid.json"],
  },
  {
    // Kept for the drafts still stored in v1 shape; the backend lifts them
    // to v2 on read (ADR-015), and nothing new is written against it.
    schema: "schemas/content/editorial-catalog.v1.schema.json",
    data: ["fixtures/content/editorial-catalog.v1.valid.json"],
  },
  {
    schema: "schemas/content/editorial-catalog.v2.schema.json",
    // The real editorial catalog is validated alongside the fixture: the
    // admin console saves drafts against this schema, so the schema must
    // keep describing the document the pipeline actually maintains.
    data: [
      "fixtures/content/editorial-catalog.v2.valid.json",
      "../tools/content-pipeline/editorial/catalog.json",
    ],
  },
];

async function listJsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(path);
    }
  }

  return files.sort();
}

async function readJson(path) {
  return JSON.parse(await readFile(join(contractsRoot, path), "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertUnique(values, description) {
  const duplicates = values.filter(
    (value, index) => values.indexOf(value) !== index,
  );
  assert(
    duplicates.length === 0,
    `${description} contains duplicate values: ${[...new Set(duplicates)].join(", ")}`,
  );
}

function validateFeatureRegistry(featureRegistry) {
  const flags = featureRegistry.flags;
  assertUnique(
    flags.map((flag) => flag.key),
    "Feature flag registry",
  );

  for (const flag of flags) {
    if (flag.type === "string") {
      assert(
        flag.allowedValues.includes(flag.defaultValue),
        `${flag.key} defaultValue is not in allowedValues`,
      );
    }

    if (flag.type === "number") {
      assert(
        flag.defaultValue >= flag.minimum && flag.defaultValue <= flag.maximum,
        `${flag.key} defaultValue is outside its registered range`,
      );
    }

    if (flag.key.startsWith("ads.")) {
      assert(
        flag.type === "boolean" && flag.defaultValue === false,
        `${flag.key} must be a boolean with a false default`,
      );
    }
  }
}

function validateAdRegistry(adRegistry, featureRegistry) {
  const flagsByKey = new Map(
    featureRegistry.flags.map((flag) => [flag.key, flag]),
  );

  assertUnique(
    adRegistry.placements.map((placement) => placement.key),
    "Advertising placement registry",
  );

  for (const placement of adRegistry.placements) {
    const flag = flagsByKey.get(placement.featureFlag);
    assert(
      flag !== undefined,
      `${placement.key} references unknown flag ${placement.featureFlag}`,
    );
    assert(
      flag.type === "boolean" && flag.defaultValue === false,
      `${placement.key} must reference a default-off boolean flag`,
    );
  }
}

function matchesRegisteredType(value, type) {
  if (type === "integer") {
    return Number.isInteger(value);
  }

  return typeof value === type;
}

function validateAnalyticsBatches(eventRegistry, batches) {
  const eventsByName = new Map(
    eventRegistry.events.map((event) => [event.name, event]),
  );
  assertUnique(
    eventRegistry.events.map((event) => `${event.name}@${event.schemaVersion}`),
    "Analytics event registry",
  );

  for (const batch of batches) {
    for (const event of batch.events) {
      const definition = eventsByName.get(event.eventName);
      assert(
        definition !== undefined,
        `Analytics batch contains unknown event ${event.eventName}`,
      );
      assert(
        definition.schemaVersion === event.schemaVersion,
        `${event.eventName} uses unregistered schemaVersion`,
      );

      const registeredProperties = definition.properties;
      for (const propertyName of Object.keys(event.properties)) {
        assert(
          registeredProperties[propertyName] !== undefined,
          `${event.eventName} contains unknown property ${propertyName}`,
        );
      }

      for (const [propertyName, propertyDefinition] of Object.entries(
        registeredProperties,
      )) {
        const value = event.properties[propertyName];
        if (propertyDefinition.required) {
          assert(
            value !== undefined,
            `${event.eventName} is missing required property ${propertyName}`,
          );
        }

        if (value !== undefined) {
          assert(
            matchesRegisteredType(value, propertyDefinition.type),
            `${event.eventName}.${propertyName} has an invalid type`,
          );
          if (propertyDefinition.enumValues !== undefined) {
            assert(
              propertyDefinition.enumValues.includes(value),
              `${event.eventName}.${propertyName} is outside its allowlist`,
            );
          }
        }
      }
    }
  }
}

const schemaFiles = await listJsonFiles(join(contractsRoot, "schemas"));
const schemas = await Promise.all(
  schemaFiles.map(async (path) => ({
    path,
    schema: JSON.parse(await readFile(path, "utf8")),
  })),
);

assertUnique(
  schemas.map(({ schema }) => schema.$id),
  "JSON Schema $id registry",
);

for (const { path, schema } of schemas) {
  const displayPath = relative(contractsRoot, path);
  assert(
    typeof schema.$id === "string" &&
      schema.$id.startsWith("https://country-flags.app/contracts/") &&
      /\/v[0-9]+\//.test(schema.$id),
    `${displayPath} must have a stable, versioned country-flags.app $id`,
  );
  assert(
    schema.$schema === "https://json-schema.org/draft/2020-12/schema",
    `${displayPath} must use JSON Schema Draft 2020-12`,
  );
  assert(
    schema.type !== "object" || schema.additionalProperties === false,
    `${displayPath} must reject unknown top-level fields`,
  );
}

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
});
addFormats(ajv);

for (const { schema } of schemas) {
  ajv.addSchema(schema);
}

for (const target of validationTargets) {
  const schema = await readJson(target.schema);
  const validate = ajv.getSchema(schema.$id);
  assert(validate !== undefined, `Schema was not compiled: ${target.schema}`);

  for (const dataPath of target.data) {
    const data = await readJson(dataPath);
    if (!validate(data)) {
      throw new Error(
        `${dataPath} does not match ${target.schema}:\n${ajv.errorsText(
          validate.errors,
          { separator: "\n" },
        )}`,
      );
    }
  }
}

const featureRegistry = await readJson("registries/feature-flags.json");
const adRegistry = await readJson("registries/ad-placements.json");
const eventRegistry = await readJson("registries/analytics-events.json");
const analyticsBatches = await Promise.all(
  validationTargets
    .find((target) => target.schema.includes("analytics/batch"))
    .data.map(readJson),
);

validateFeatureRegistry(featureRegistry);
validateAdRegistry(adRegistry, featureRegistry);
validateAnalyticsBatches(eventRegistry, analyticsBatches);

console.log(
  `Validated ${schemas.length} schemas and ${validationTargets.reduce(
    (total, target) => total + target.data.length,
    0,
  )} contract documents.`,
);
