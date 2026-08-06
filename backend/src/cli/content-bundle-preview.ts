import "dotenv/config";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

import { loadSigningPublicKeys } from "../modules/content/bundle/bundle-signer";
import { validateBundle } from "../modules/content/bundle/bundle-validator";
import { diffBundleAgainstActive } from "../modules/content/bundle/bundle-diff";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const bundleDirArgument = option(args, "--bundle-dir");
  if (bundleDirArgument === undefined) {
    throw new Error("content:bundle:preview requires --bundle-dir <path>");
  }

  const { domain } = await validateBundle(
    resolve(bundleDirArgument),
    loadSigningPublicKeys(),
  );

  const prisma = new PrismaClient();
  try {
    const diff = await diffBundleAgainstActive(prisma, domain);
    process.stdout.write(
      `${JSON.stringify(
        {
          previousActiveVersion: diff.previousActiveVersion,
          nextVersion: domain.catalog.catalogVersion,
          changes: diff.resourceChanges.map((change) => ({
            resourceType: change.resourceType,
            upserted: change.upsertedKeys.length,
            retired: change.retiredKeys.length,
          })),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Content bundle preview failed: ${message}\n`);
  process.exitCode = 1;
});
