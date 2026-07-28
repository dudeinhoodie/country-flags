import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

const contractsRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const baseRef = process.env.CONTRACT_BASE_REF ?? "origin/master";

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

function readFromGit(ref, path) {
  const result = spawnSync("git", ["show", `${ref}:${path}`], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  if (result.status === 0) {
    return result.stdout;
  }

  if (
    result.stderr.includes("does not exist in") ||
    result.stderr.includes("exists on disk, but not in")
  ) {
    return null;
  }

  throw new Error(
    `Unable to read ${path} from ${ref}: ${result.stderr.trim()}`,
  );
}

function listFromGit(ref, path) {
  const result = spawnSync("git", ["ls-tree", "-r", "--name-only", ref, path], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `Unable to inspect ${path} at ${ref}: ${result.stderr.trim()}`,
    );
  }

  return result.stdout.split("\n").filter(Boolean);
}

function parseMajor(version) {
  const match = /^([0-9]+)\./.exec(version);
  return match === null ? null : Number(match[1]);
}

function mergeOpenApiComponents(document, externalComponents) {
  return {
    ...document,
    components: {
      ...externalComponents,
      ...document.components,
      schemas: {
        ...externalComponents.schemas,
        ...document.components?.schemas,
      },
    },
  };
}

function toTypeSet(type) {
  if (type === undefined) {
    return null;
  }
  return new Set(Array.isArray(type) ? type : [type]);
}

function detectSchemaBreakingChanges(previous, current, path = "$") {
  const changes = [];

  if (
    previous === null ||
    current === null ||
    typeof previous !== "object" ||
    typeof current !== "object"
  ) {
    return changes;
  }

  const previousTypes = toTypeSet(previous.type);
  const currentTypes = toTypeSet(current.type);
  if (
    previousTypes !== null &&
    currentTypes !== null &&
    [...previousTypes].some((type) => !currentTypes.has(type))
  ) {
    changes.push(`${path}: accepted type was removed`);
  }

  if (
    Object.hasOwn(previous, "const") &&
    (!Object.hasOwn(current, "const") || previous.const !== current.const)
  ) {
    changes.push(`${path}: const value changed`);
  }

  if (Array.isArray(previous.enum) && Array.isArray(current.enum)) {
    for (const value of previous.enum) {
      if (!current.enum.some((candidate) => candidate === value)) {
        changes.push(
          `${path}: enum value ${JSON.stringify(value)} was removed`,
        );
      }
    }
  }

  const increasingMinimums = [
    "minimum",
    "exclusiveMinimum",
    "minLength",
    "minItems",
  ];
  for (const keyword of increasingMinimums) {
    if (
      typeof previous[keyword] === "number" &&
      typeof current[keyword] === "number" &&
      current[keyword] > previous[keyword]
    ) {
      changes.push(`${path}: ${keyword} became more restrictive`);
    }
  }

  const decreasingMaximums = [
    "maximum",
    "exclusiveMaximum",
    "maxLength",
    "maxItems",
  ];
  for (const keyword of decreasingMaximums) {
    if (
      typeof previous[keyword] === "number" &&
      typeof current[keyword] === "number" &&
      current[keyword] < previous[keyword]
    ) {
      changes.push(`${path}: ${keyword} became more restrictive`);
    }
  }

  if (
    previous.additionalProperties !== false &&
    current.additionalProperties === false
  ) {
    changes.push(`${path}: unknown properties are no longer accepted`);
  }

  const previousProperties = previous.properties ?? {};
  const currentProperties = current.properties ?? {};
  const previousRequired = new Set(previous.required ?? []);
  const currentRequired = new Set(current.required ?? []);

  for (const propertyName of Object.keys(previousProperties)) {
    if (!Object.hasOwn(currentProperties, propertyName)) {
      changes.push(`${path}.${propertyName}: property was removed`);
      continue;
    }
    changes.push(
      ...detectSchemaBreakingChanges(
        previousProperties[propertyName],
        currentProperties[propertyName],
        `${path}.${propertyName}`,
      ),
    );
  }

  for (const propertyName of currentRequired) {
    if (!previousRequired.has(propertyName)) {
      changes.push(`${path}.${propertyName}: property became required`);
    }
  }

  if (previous.items !== undefined && current.items !== undefined) {
    changes.push(
      ...detectSchemaBreakingChanges(
        previous.items,
        current.items,
        `${path}[]`,
      ),
    );
  }

  return changes;
}

function detectOpenApiBreakingChanges(previous, current) {
  const changes = [];
  const methods = ["get", "post", "put", "patch", "delete", "options", "head"];

  for (const [path, previousPathItem] of Object.entries(previous.paths ?? {})) {
    const currentPathItem = current.paths?.[path];
    if (currentPathItem === undefined) {
      changes.push(`${path}: path was removed`);
      continue;
    }

    for (const method of methods) {
      if (
        previousPathItem[method] !== undefined &&
        currentPathItem[method] === undefined
      ) {
        changes.push(`${method.toUpperCase()} ${path}: operation was removed`);
      }
    }
  }

  for (const [name, previousSchema] of Object.entries(
    previous.components?.schemas ?? {},
  )) {
    const currentSchema = current.components?.schemas?.[name];
    if (currentSchema === undefined) {
      changes.push(`components.schemas.${name}: schema was removed`);
      continue;
    }
    changes.push(
      ...detectSchemaBreakingChanges(
        previousSchema,
        currentSchema,
        `components.schemas.${name}`,
      ),
    );
  }

  return changes;
}

function registryEntries(document) {
  if (Array.isArray(document.flags)) {
    return ["flags", "key", document.flags];
  }
  if (Array.isArray(document.placements)) {
    return ["placements", "key", document.placements];
  }
  if (Array.isArray(document.events)) {
    return [
      "events",
      "key",
      document.events.map((event) => ({
        ...event,
        key: `${event.name}@${event.schemaVersion}`,
      })),
    ];
  }
  throw new Error("Unknown registry document");
}

function detectRegistryBreakingChanges(previous, current) {
  const [collectionName, keyName, previousEntries] = registryEntries(previous);
  const [, , currentEntries] = registryEntries(current);
  const currentByKey = new Map(
    currentEntries.map((entry) => [entry[keyName] ?? entry.key, entry]),
  );
  const changes = [];

  for (const previousEntry of previousEntries) {
    const key = previousEntry[keyName] ?? previousEntry.key;
    const currentEntry = currentByKey.get(key);
    if (currentEntry === undefined) {
      changes.push(`${collectionName}.${key}: entry was removed`);
      continue;
    }

    for (const field of ["type", "defaultValue", "format"]) {
      if (
        Object.hasOwn(previousEntry, field) &&
        previousEntry[field] !== currentEntry[field]
      ) {
        changes.push(`${collectionName}.${key}: ${field} changed`);
      }
    }

    if (previousEntry.properties !== undefined) {
      changes.push(
        ...detectSchemaBreakingChanges(
          {
            type: "object",
            properties: Object.fromEntries(
              Object.entries(previousEntry.properties).map(
                ([name, definition]) => [
                  name,
                  {
                    type: definition.type,
                    ...(definition.enumValues === undefined
                      ? {}
                      : { enum: definition.enumValues }),
                  },
                ],
              ),
            ),
            required: Object.entries(previousEntry.properties)
              .filter(([, definition]) => definition.required)
              .map(([name]) => name),
          },
          {
            type: "object",
            properties: Object.fromEntries(
              Object.entries(currentEntry.properties ?? {}).map(
                ([name, definition]) => [
                  name,
                  {
                    type: definition.type,
                    ...(definition.enumValues === undefined
                      ? {}
                      : { enum: definition.enumValues }),
                  },
                ],
              ),
            ),
            required: Object.entries(currentEntry.properties)
              .filter(([, definition]) => definition.required)
              .map(([name]) => name),
          },
          `${collectionName}.${key}.properties`,
        ),
      );
    }
  }

  return changes;
}

const failures = [];
const currentSchemaPaths = (
  await listJsonFiles(join(contractsRoot, "schemas"))
).map((path) => relative(repositoryRoot, path));
const previousSchemaPaths = listFromGit(baseRef, "contracts/schemas").filter(
  (path) => path.endsWith(".json"),
);

for (const previousPath of previousSchemaPaths) {
  if (!currentSchemaPaths.includes(previousPath)) {
    failures.push(
      `${previousPath}: versioned schema was deleted; keep it and add a new version`,
    );
  }
}

for (const path of currentSchemaPaths) {
  const previousSource = readFromGit(baseRef, path);
  if (previousSource === null) {
    continue;
  }

  const previous = JSON.parse(previousSource);
  const current = JSON.parse(
    await readFile(join(repositoryRoot, path), "utf8"),
  );
  const breakingChanges = detectSchemaBreakingChanges(previous, current);

  if (breakingChanges.length > 0 && previous.$id === current.$id) {
    failures.push(
      `${path}: breaking changes require a new versioned $id:\n  - ${breakingChanges.join(
        "\n  - ",
      )}`,
    );
  }
}

const openApiPath = "contracts/openapi.yaml";
const openApiComponentsPath = "contracts/openapi/components.yaml";
const previousOpenApiSource = readFromGit(baseRef, openApiPath);
if (previousOpenApiSource !== null) {
  const previousComponentsSource = readFromGit(baseRef, openApiComponentsPath);
  const previous = mergeOpenApiComponents(
    parseYaml(previousOpenApiSource),
    previousComponentsSource === null
      ? {}
      : parseYaml(previousComponentsSource),
  );
  const current = mergeOpenApiComponents(
    parseYaml(await readFile(join(repositoryRoot, openApiPath), "utf8")),
    parseYaml(
      await readFile(join(repositoryRoot, openApiComponentsPath), "utf8"),
    ),
  );
  const breakingChanges = detectOpenApiBreakingChanges(previous, current);
  const previousMajor = parseMajor(previous.info.version);
  const currentMajor = parseMajor(current.info.version);

  if (
    breakingChanges.length > 0 &&
    (previousMajor === null ||
      currentMajor === null ||
      currentMajor <= previousMajor)
  ) {
    failures.push(
      `${openApiPath}: breaking changes require an API major version bump:\n  - ${breakingChanges.join(
        "\n  - ",
      )}`,
    );
  }
}

for (const path of [
  "contracts/registries/feature-flags.json",
  "contracts/registries/ad-placements.json",
  "contracts/registries/analytics-events.json",
]) {
  const previousSource = readFromGit(baseRef, path);
  if (previousSource === null) {
    continue;
  }
  const previous = JSON.parse(previousSource);
  const current = JSON.parse(
    await readFile(join(repositoryRoot, path), "utf8"),
  );
  const breakingChanges = detectRegistryBreakingChanges(previous, current);

  if (
    breakingChanges.length > 0 &&
    current.schemaVersion <= previous.schemaVersion
  ) {
    failures.push(
      `${path}: breaking registry changes require schemaVersion bump:\n  - ${breakingChanges.join(
        "\n  - ",
      )}`,
    );
  }
}

if (failures.length > 0) {
  throw new Error(`Contract compatibility failed:\n\n${failures.join("\n\n")}`);
}

console.log(`Contracts are compatible with ${baseRef}.`);
