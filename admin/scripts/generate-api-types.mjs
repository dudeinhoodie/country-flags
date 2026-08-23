// Generates the typed admin API surface from the bundled admin contract.
// `--check` verifies the committed file matches what the contract produces,
// mirroring the sync-and-check pattern used elsewhere in the repository.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";

const bundleUrl = new URL(
  "../../contracts/dist/admin-openapi.bundle.yaml",
  import.meta.url,
);
const outputUrl = new URL("../src/api/generated/admin-api.d.ts", import.meta.url);
const outputPath = fileURLToPath(outputUrl);
const checkMode = process.argv.includes("--check");

const header =
  "// Generated from contracts/dist/admin-openapi.bundle.yaml.\n" +
  "// Do not edit by hand: run `corepack yarn admin:api:generate` at the repository root.\n";

let bundle;
try {
  bundle = await readFile(bundleUrl, "utf8");
} catch {
  console.error(
    `✗ Missing ${fileURLToPath(bundleUrl)}. ` +
      "Run `corepack yarn contracts:bundle` first (the root admin:api:* scripts do).",
  );
  process.exit(1);
}

const ast = await openapiTS(bundle);
const generated = header + astToString(ast);

if (checkMode) {
  let committed = null;
  try {
    committed = await readFile(outputUrl, "utf8");
  } catch {
    // handled below: a missing file is drift too
  }
  if (committed !== generated) {
    console.error(
      `✗ ${outputPath} is out of date with the admin contract. ` +
        "Run `corepack yarn admin:api:generate` and commit the result.",
    );
    process.exit(1);
  }
  console.log(`✓ ${outputPath} matches the admin contract`);
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputUrl, generated);
  console.log(`✓ Wrote ${outputPath}`);
}
