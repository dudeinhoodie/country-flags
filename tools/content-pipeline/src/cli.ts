#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildBundle, readReports } from "./build.js";
import { diffBundles } from "./diff.js";
import { loadRegistry, pullSource } from "./registry.js";
import { syncSelection } from "./selection.js";
import { stableJson } from "./stable-json.js";
import type { SourceKey } from "./types.js";
import { validateBundle } from "./validate.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function latestBuiltVersion(outputRoot: string): Promise<string> {
  const entries = await readdir(outputRoot, { withFileTypes: true }).catch(
    () => [],
  );
  const version = entries
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort((left, right) => left.localeCompare(right, "en"))
    .at(-1);
  if (version === undefined) {
    throw new Error("No generated content version is available");
  }
  return version;
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (command === "pull") {
    const source = option(rest, "--source") as SourceKey | "all" | undefined;
    const revision = option(rest, "--version");
    if ((source === undefined || source === "all") && revision !== undefined) {
      throw new Error("pull --version requires one concrete --source");
    }
    if (source === undefined || source === "all") {
      await pullSource(
        root,
        "un-m49",
        undefined,
        rest.includes("--update-registry"),
      );
      await syncSelection(root);
    }
    const registry = await loadRegistry(root);
    const keys =
      source === undefined || source === "all"
        ? registry.sources
            .map(({ key }) => key)
            .filter((key) => key !== "un-m49" && key !== "editorial")
        : [source];
    for (const key of keys) {
      await pullSource(root, key, revision, rest.includes("--update-registry"));
      process.stdout.write(`Pulled ${key}\n`);
    }
    return;
  }
  if (command === "sync-selection") {
    await syncSelection(root);
    process.stdout.write("Synchronized full editorial selection\n");
    return;
  }

  const version =
    option(rest, "--catalog-version") ??
    option(rest, "--version") ??
    process.env.CONTENT_VERSION;
  const outputRoot = resolve(
    option(rest, "--output") ?? join(root, "../../content/generated"),
  );

  if (command === "build") {
    if (version === undefined) {
      throw new Error("build requires --catalog-version <version>");
    }
    const assetBase = option(rest, "--asset-base-url");
    const result = await buildBundle({
      root,
      outputRoot,
      catalogVersion: version,
      publishReady: rest.includes("--publish-ready"),
      // Omitted, the manifest records the production CDN as it always has.
      ...(assetBase === undefined ? {} : { assetBaseUrl: assetBase }),
    });
    process.stdout.write(
      `Built ${result.outputDirectory} (${String(Object.keys(result.fileHashes).length)} JSON files)\n`,
    );
    return;
  }
  if (command === "validate") {
    const selectedVersion = version ?? (await latestBuiltVersion(outputRoot));
    await validateBundle(root, join(outputRoot, selectedVersion));
    process.stdout.write(`Validated ${selectedVersion}\n`);
    return;
  }
  if (command === "report") {
    const selectedVersion = version ?? (await latestBuiltVersion(outputRoot));
    const reports = await readReports(join(outputRoot, selectedVersion));
    process.stdout.write(
      stableJson(
        Object.fromEntries(
          Object.entries(reports).map(([name, items]) => [name, items.length]),
        ),
      ),
    );
    return;
  }
  if (command === "diff") {
    const selectedVersion = version ?? (await latestBuiltVersion(outputRoot));
    const against = option(rest, "--against");
    if (against === undefined) {
      throw new Error("diff requires --against <version>");
    }
    process.stdout.write(
      stableJson(
        await diffBundles(
          join(outputRoot, selectedVersion),
          join(outputRoot, against),
        ),
      ),
    );
    return;
  }
  throw new Error(
    "Usage: content <pull|sync-selection|build|validate|diff|report> [options]",
  );
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
