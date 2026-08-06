import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { ValidateFunction } from "ajv";

import { sha256Hex, type LoadedBundle } from "./bundle-reader";

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

function repositoryRoot(): string {
  return resolve(__dirname, "../../../../..");
}

async function loadAjv(): Promise<Ajv2020> {
  const root = repositoryRoot();
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const path of SCHEMA_PATHS) {
    const schema = JSON.parse(
      await readFile(resolve(root, path), "utf8"),
    ) as Record<string, unknown>;
    ajv.addSchema(schema);
  }
  return ajv;
}

function assertValid(
  ajv: Ajv2020,
  schemaId: string,
  path: string,
  document: unknown,
): void {
  const validate: ValidateFunction | undefined = ajv.getSchema(schemaId);
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

/** Schema + checksum validation only. Cross-file, signature, and business-rule checks live in bundle-validator.ts. */
export async function validateBundleSchemas(
  bundle: LoadedBundle,
): Promise<void> {
  const ajv = await loadAjv();
  const manifestSchemaId =
    "https://country-flags.app/contracts/content/v1/manifest.schema.json";
  assertValid(ajv, manifestSchemaId, "manifest.json", bundle.manifest);

  for (const file of bundle.manifest.files) {
    const content = bundle.filesByPath.get(file.path);
    if (content === undefined) {
      throw new Error(`Bundle is missing ${file.path} listed in manifest.json`);
    }
    if (
      content.byteLength !== file.bytes ||
      sha256Hex(content) !== file.sha256
    ) {
      throw new Error(
        `${file.path} checksum or byte count does not match manifest`,
      );
    }
    assertValid(
      ajv,
      file.schemaId,
      file.path,
      JSON.parse(content.toString("utf8")) as unknown,
    );
  }
}
