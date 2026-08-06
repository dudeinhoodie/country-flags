import "dotenv/config";
import { resolve } from "node:path";

import {
  loadSigningPrivateKey,
  signManifest,
} from "../modules/content/bundle/bundle-signer";
import {
  readManifest,
  writeManifest,
} from "../modules/content/bundle/bundle-reader";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const bundleDirArgument = option(args, "--bundle-dir");
  if (bundleDirArgument === undefined) {
    throw new Error("content:bundle:sign requires --bundle-dir <path>");
  }
  const bundleDir = resolve(bundleDirArgument);

  const { keyId, privateKeyPem } = loadSigningPrivateKey();
  const manifest = await readManifest(bundleDir);
  manifest.signature = signManifest(manifest, privateKeyPem, keyId);
  await writeManifest(bundleDir, manifest);

  process.stdout.write(`Signed ${manifest.contentVersion} with key ${keyId}\n`);
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Content bundle sign failed: ${message}\n`);
  process.exitCode = 1;
});
