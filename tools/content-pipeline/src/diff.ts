import { join } from "node:path";

import { readJson, stableJson } from "./stable-json.js";

type RecordWithKey = Record<string, unknown> & {
  key?: string;
  entityKey?: string;
};

function indexBy(
  values: RecordWithKey[],
  field: "key" | "entityKey",
): Map<string, RecordWithKey> {
  return new Map(
    values.flatMap((value) => {
      const key = value[field];
      return typeof key === "string" ? [[key, value] as const] : [];
    }),
  );
}

function compareRecords(
  current: RecordWithKey[],
  previous: RecordWithKey[],
  field: "key" | "entityKey",
): { added: string[]; removed: string[]; changed: string[] } {
  const currentByKey = indexBy(current, field);
  const previousByKey = indexBy(previous, field);
  return {
    added: [...currentByKey.keys()]
      .filter((key) => !previousByKey.has(key))
      .sort(),
    removed: [...previousByKey.keys()]
      .filter((key) => !currentByKey.has(key))
      .sort(),
    changed: [...currentByKey.entries()]
      .filter(([key, value]) => {
        const oldValue = previousByKey.get(key);
        return (
          oldValue !== undefined && stableJson(value) !== stableJson(oldValue)
        );
      })
      .map(([key]) => key)
      .sort(),
  };
}

export async function diffBundles(
  currentDirectory: string,
  previousDirectory: string,
): Promise<Record<string, unknown>> {
  const currentCatalog = await readJson<{ entities: RecordWithKey[] }>(
    join(currentDirectory, "catalog.json"),
  );
  const previousCatalog = await readJson<{ entities: RecordWithKey[] }>(
    join(previousDirectory, "catalog.json"),
  );
  const facts = Object.fromEntries(
    await Promise.all(
      ["capitals", "currencies", "languages", "population"].map(
        async (factType) => {
          const current = await readJson<{ records: RecordWithKey[] }>(
            join(currentDirectory, `facts/${factType}.json`),
          );
          const previous = await readJson<{ records: RecordWithKey[] }>(
            join(previousDirectory, `facts/${factType}.json`),
          );
          return [
            factType,
            compareRecords(current.records, previous.records, "entityKey"),
          ] as const;
        },
      ),
    ),
  );
  const currentAssets = await readJson<{ assets: RecordWithKey[] }>(
    join(currentDirectory, "assets/assets.json"),
  );
  const previousAssets = await readJson<{ assets: RecordWithKey[] }>(
    join(previousDirectory, "assets/assets.json"),
  );

  return {
    catalog: compareRecords(
      currentCatalog.entities,
      previousCatalog.entities,
      "key",
    ),
    facts,
    assets: compareRecords(currentAssets.assets, previousAssets.assets, "key"),
  };
}
