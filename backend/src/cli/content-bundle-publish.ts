import "dotenv/config";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

import { createObjectStorage } from "../infrastructure/object-storage/create-object-storage";
import { loadObjectStorageConfig } from "../infrastructure/object-storage/object-storage.config";
import { loadSigningPublicKeys } from "../modules/content/bundle/bundle-signer";
import { publishBundle } from "../modules/content/bundle/bundle-publisher";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const bundleDirArgument = option(args, "--bundle-dir");
  if (bundleDirArgument === undefined) {
    throw new Error("content:bundle:publish requires --bundle-dir <path>");
  }

  if (
    loadObjectStorageConfig().provider === "memory" &&
    !args.includes("--allow-ephemeral-storage")
  ) {
    throw new Error(
      "OBJECT_STORAGE_PROVIDER=memory would record the release in the database while the uploaded bundle files vanish when this process exits. Configure the S3/MinIO provider, or pass --allow-ephemeral-storage for a throwaway smoke test.",
    );
  }

  const prisma = new PrismaClient();
  try {
    const summary = await publishBundle(
      resolve(bundleDirArgument),
      loadSigningPublicKeys(),
      prisma,
      createObjectStorage(),
    );
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Content bundle publish failed: ${message}\n`);
  process.exitCode = 1;
});
