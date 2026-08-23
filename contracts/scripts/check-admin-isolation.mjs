import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

// The client bundle is mirrored byte-for-byte into the iOS generator, so an
// admin path that slips into it ships straight into the app client. This
// check keeps the two contract roots from bleeding into each other.

const contractsRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

const clientBundlePath = join(contractsRoot, "dist/openapi.bundle.yaml");
const adminBundlePath = join(contractsRoot, "dist/admin-openapi.bundle.yaml");
const iosMirrorPath = join(
  repositoryRoot,
  "ios/CountryFlagsKit/Sources/CountryFlagsInfrastructure/openapi.yaml",
);

const ADMIN_PREFIX = "/v1/admin";

async function readPaths(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `Unable to read ${filePath}: ${error.message}. ` +
        "Run `yarn bundle` in contracts/ first.",
    );
  }
  const document = parseYaml(raw);
  return Object.keys(document.paths ?? {});
}

const failures = [];

const clientPaths = await readPaths(clientBundlePath);
const leakedIntoClient = clientPaths.filter((path) =>
  path.startsWith(ADMIN_PREFIX),
);
if (leakedIntoClient.length > 0) {
  failures.push(
    `Client bundle ${clientBundlePath} must not contain admin paths, ` +
      `found: ${leakedIntoClient.join(", ")}`,
  );
}

const adminPaths = await readPaths(adminBundlePath);
if (adminPaths.length === 0) {
  failures.push(`Admin bundle ${adminBundlePath} declares no paths`);
}
const escapedAdminNamespace = adminPaths.filter(
  (path) => !path.startsWith(ADMIN_PREFIX),
);
if (escapedAdminNamespace.length > 0) {
  failures.push(
    `Admin bundle ${adminBundlePath} must stay under ${ADMIN_PREFIX}, ` +
      `found: ${escapedAdminNamespace.join(", ")}`,
  );
}

// The generated Swift client is built from this committed mirror (iOS CI
// verifies the mirror equals the client bundle), so a clean mirror is what
// proves no admin operation reaches the generated Swift code.
const iosMirrorPaths = await readPaths(iosMirrorPath);
const leakedIntoIos = iosMirrorPaths.filter((path) =>
  path.startsWith(ADMIN_PREFIX),
);
if (leakedIntoIos.length > 0) {
  failures.push(
    `iOS contract mirror ${iosMirrorPath} must not contain admin paths, ` +
      `found: ${leakedIntoIos.join(", ")}`,
  );
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`✗ ${failure}`);
  }
  process.exit(1);
}

console.log(
  `✓ ${clientPaths.length} client paths and ${iosMirrorPaths.length} mirrored paths are admin-free; ` +
    `${adminPaths.length} admin paths stay under ${ADMIN_PREFIX}`,
);
