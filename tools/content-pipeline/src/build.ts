import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { normalizeSource } from "./adapters.js";
import { buildLearningContent } from "./learning.js";
import { createMatcher } from "./matching.js";
import { loadAssetOverrides } from "./asset-overrides.js";
import { mergeContent } from "./merge.js";
import { loadRegistry, loadVerifiedSnapshot } from "./registry.js";
import { readJson, sha256, writeJson } from "./stable-json.js";
import type {
  BuildOptions,
  BuildResult,
  EditorialCatalog,
  PipelineReports,
  Provenance,
} from "./types.js";
import { validateBundle } from "./validate.js";

const SCHEMAS = {
  catalog: "https://country-flags.example/schemas/catalog.schema.json",
  facts: "https://country-flags.app/content/v1/fact-collection.schema.json",
  assets: "https://country-flags.app/content/v1/asset-registry.schema.json",
  provenance: "https://country-flags.app/content/v1/provenance.schema.json",
  report: "https://country-flags.app/content/v1/pipeline-report.schema.json",
  cardTemplates:
    "https://country-flags.app/content/v1/card-templates.schema.json",
  learningCards:
    "https://country-flags.app/content/v1/learning-cards.schema.json",
} as const;

function assertVersion(version: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(version)) {
    throw new Error("catalog version must be a path-safe version identifier");
  }
}

/**
 * Where the manifest says the assets of this release are served from.
 *
 * The default is the production CDN, unchanged: a release built without an
 * opinion records what it always recorded. An environment that serves the
 * release from its own bucket passes its own address, and the contract
 * requires it to be HTTPS and to end where a file path can be appended.
 */
function assetBaseUrl(options: BuildOptions): string {
  const configured = options.assetBaseUrl;
  if (configured === undefined) {
    return `https://cdn.country-flags.app/content/${options.catalogVersion}/`;
  }
  if (!configured.startsWith("https://")) {
    throw new Error(`assetBaseUrl must be https:// (received ${configured})`);
  }
  return configured.endsWith("/") ? configured : `${configured}/`;
}

/**
 * The oldest client this release lets read it.
 *
 * The default is what it has always been. A dev environment publishes for the
 * build that exists rather than for the one the store will eventually carry:
 * a release above the running app's version is answered with an update screen,
 * so an app at 0.1.0 reading a release that demands 1.0.0 sees no catalogue at
 * all — the mock has been overriding exactly this for the same reason.
 */
function minimumClientVersion(options: BuildOptions): string {
  const configured = options.minimumClientVersion;
  if (configured === undefined) {
    return "1.0.0";
  }
  if (!/^\d+\.\d+\.\d+$/u.test(configured)) {
    throw new Error(
      `minimumClientVersion must be major.minor.patch (received ${configured})`,
    );
  }
  return configured;
}

function blockingReportCount(reports: PipelineReports): number {
  return (
    reports.unresolvedEntities.length +
    reports.fieldConflicts.filter(({ blocking }) => blocking).length +
    reports.missingTranslations.length +
    reports.missingAssets.length +
    reports.licenseProblems.length
  );
}

export async function buildBundle(options: BuildOptions): Promise<BuildResult> {
  assertVersion(options.catalogVersion);
  const registry = await loadRegistry(options.root);
  const editorialSource = registry.sources.find(
    ({ key }) => key === "editorial",
  );
  if (editorialSource === undefined) {
    throw new Error("Editorial source is required");
  }
  const editorial = await loadVerifiedSnapshot<EditorialCatalog>(
    options.root,
    editorialSource,
  );
  const sourceSnapshots = await Promise.all(
    registry.sources
      .filter(({ key }) => key !== "editorial")
      .map(async (source) => ({
        source,
        snapshot: await loadVerifiedSnapshot(options.root, source),
      })),
  );
  const normalized = sourceSnapshots.map(({ source, snapshot }) =>
    normalizeSource(snapshot, source),
  );
  const matcher = createMatcher(editorial, normalized);
  const outputDirectory = join(options.outputRoot, options.catalogVersion);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const editorialProvenance: Provenance = {
    sourceKey: "editorial",
    revision: editorialSource.revision,
    retrievedAt: editorialSource.retrievedAt,
  };
  const merged = await mergeContent(
    outputDirectory,
    options.catalogVersion,
    editorial,
    normalized,
    matcher,
    editorialProvenance,
    await loadAssetOverrides(
      options.root,
      editorial.assetOverrides,
      editorialProvenance,
    ),
  );
  const files: { path: string; schemaId: string }[] = [];
  const add = async (
    path: string,
    schemaId: string,
    document: unknown,
  ): Promise<void> => {
    await writeJson(join(outputDirectory, path), document);
    files.push({ path, schemaId });
  };

  const createdAt = registry.sources
    .map(({ retrievedAt }) => retrievedAt)
    .sort()
    .at(-1);
  const learning = buildLearningContent(
    merged.catalog.decks as { key: string; memberEntityKeys: string[] }[],
    merged.assets,
    String(createdAt),
  );

  await add("catalog.json", SCHEMAS.catalog, merged.catalog);
  for (const [factType, document] of Object.entries(merged.facts)) {
    await add(`facts/${factType}.json`, SCHEMAS.facts, document);
  }
  await add("assets/assets.json", SCHEMAS.assets, {
    schemaVersion: 1,
    assets: merged.assets,
  });
  await add(
    "card-templates.json",
    SCHEMAS.cardTemplates,
    learning.cardTemplates,
  );
  await add(
    "learning-cards.json",
    SCHEMAS.learningCards,
    learning.learningCards,
  );
  await add("provenance/provenance.json", SCHEMAS.provenance, {
    schemaVersion: 1,
    fields: merged.provenance,
  });
  const reportEntries: [string, unknown[]][] = [
    ["unresolvedEntities", merged.reports.unresolvedEntities],
    ["fieldConflicts", merged.reports.fieldConflicts],
    ["missingTranslations", merged.reports.missingTranslations],
    ["missingAssets", merged.reports.missingAssets],
    ["licenseProblems", merged.reports.licenseProblems],
    ["assetOverrides", merged.reports.assetOverrides],
  ];
  for (const [reportType, items] of reportEntries) {
    await add(`reports/${reportFileName(reportType)}.json`, SCHEMAS.report, {
      schemaVersion: 1,
      reportType,
      items,
    });
  }

  const manifestFiles = await Promise.all(
    files
      .sort((left, right) => left.path.localeCompare(right.path, "en"))
      .map(async (file) => {
        const content = await readFile(join(outputDirectory, file.path));
        return {
          path: file.path,
          bytes: content.byteLength,
          sha256: sha256(content),
          schemaId: file.schemaId,
        };
      }),
  );
  await writeJson(join(outputDirectory, "manifest.json"), {
    $schema: "../../../contracts/schemas/content/manifest.v1.schema.json",
    schemaVersion: 1,
    contentVersion: options.catalogVersion,
    createdAt,
    defaultLocale: editorial.defaultLocale,
    supportedLocales: [...editorial.supportedLocales].sort(),
    minimumClientVersion: minimumClientVersion(options),
    supportedTemplateSchemaVersions: [1],
    assetBaseUrl: assetBaseUrl(options),
    changeCursor: `content:${options.catalogVersion}:0`,
    files: manifestFiles,
    signature: {
      algorithm: "Ed25519",
      keyId: "unsigned-candidate",
      value: "",
    },
  });
  await validateBundle(options.root, outputDirectory);

  if (options.publishReady && blockingReportCount(merged.reports) > 0) {
    throw new Error(
      `Bundle is not publish-ready: ${String(blockingReportCount(merged.reports))} blocking report item(s)`,
    );
  }
  return {
    outputDirectory,
    reports: merged.reports,
    fileHashes: Object.fromEntries(
      manifestFiles.map(({ path, sha256: hash }) => [path, hash]),
    ),
  };
}

function reportFileName(reportType: string): string {
  return reportType.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

export async function readReports(
  outputDirectory: string,
): Promise<Record<string, unknown[]>> {
  const names = [
    "unresolved-entities",
    "field-conflicts",
    "missing-translations",
    "missing-assets",
    "license-problems",
    "asset-overrides",
  ];
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => {
        const document = await readJson<{ items: unknown[] }>(
          join(outputDirectory, `reports/${name}.json`),
        );
        return [name, document.items] as const;
      }),
    ),
  );
}
