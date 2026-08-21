import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";

import { readJson, sha256 } from "./stable-json.js";

interface Manifest {
  files: {
    path: string;
    bytes: number;
    sha256: string;
    schemaId: string;
  }[];
}

interface AjvInstance {
  addSchema(schema: Record<string, unknown>): void;
  getSchema(id: string): ValidateFunction | undefined;
  errorsText(
    errors?: ErrorObject[] | null,
    options?: { separator?: string },
  ): string;
}

const AjvConstructor = Ajv2020 as unknown as new (options: {
  allErrors: boolean;
  strict: boolean;
}) => AjvInstance;
const applyFormats = addFormats as unknown as (ajv: AjvInstance) => void;

function repositoryRoot(pipelineRoot: string): string {
  return resolve(pipelineRoot, "../..");
}

const SCHEMA_PATHS = [
  "content/schemas/catalog.schema.json",
  "content/schemas/fact-collection.schema.json",
  "content/schemas/asset-registry.schema.json",
  "content/schemas/provenance.schema.json",
  "content/schemas/pipeline-report.schema.json",
  "content/schemas/card-templates.schema.json",
  "content/schemas/learning-cards.schema.json",
  "contracts/schemas/content/manifest.v1.schema.json",
];

export async function validateBundle(
  pipelineRoot: string,
  outputDirectory: string,
): Promise<void> {
  const root = repositoryRoot(pipelineRoot);
  const schemas = await Promise.all(
    SCHEMA_PATHS.map((path) =>
      readJson<Record<string, unknown>>(join(root, path)),
    ),
  );
  const ajv = new AjvConstructor({ allErrors: true, strict: true });
  applyFormats(ajv);
  for (const schema of schemas) {
    ajv.addSchema(schema);
  }

  const manifestPath = join(outputDirectory, "manifest.json");
  const manifest = await readJson<Manifest>(manifestPath);
  const manifestSchema = schemas.at(-1)?.$id;
  validateDocument(ajv, String(manifestSchema), manifestPath, manifest);

  for (const file of manifest.files) {
    const path = join(outputDirectory, file.path);
    const content = await readFile(path);
    if (content.byteLength !== file.bytes || sha256(content) !== file.sha256) {
      throw new Error(
        `${file.path} checksum or byte count does not match manifest`,
      );
    }
    validateDocument(
      ajv,
      file.schemaId,
      path,
      JSON.parse(content.toString("utf8")) as unknown,
    );
  }

  // Every published encoding, not just the vector. The registry used to name
  // one file on the asset itself and the rest in `representations`, so this
  // checked the vector and took the rasters on trust — which is half of what a
  // client actually downloads.
  const assetRegistry = await readJson<{
    assets: { representations: { path: string; sha256: string }[] }[];
  }>(join(outputDirectory, "assets/assets.json"));
  for (const asset of assetRegistry.assets) {
    for (const representation of asset.representations) {
      const content = await readFile(
        join(outputDirectory, representation.path),
      );
      if (sha256(content) !== representation.sha256) {
        throw new Error(
          `${representation.path} checksum does not match asset registry`,
        );
      }
    }
  }
}

function validateDocument(
  ajv: AjvInstance,
  schemaId: string,
  path: string,
  document: unknown,
): void {
  const validate = ajv.getSchema(schemaId);
  if (validate === undefined) {
    throw new Error(`Unknown schema ${schemaId} for ${path}`);
  }
  if (!validate(document)) {
    throw new Error(
      `${path} is invalid:\n${ajv.errorsText(validate.errors, {
        separator: "\n",
      })}`,
    );
  }
}
