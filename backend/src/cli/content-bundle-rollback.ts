import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import { createObjectStorage } from "../infrastructure/object-storage/create-object-storage";
import { rollbackContentVersion } from "../modules/content/bundle/bundle-rollback";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const targetVersion = option(args, "--to-version");
  if (targetVersion === undefined) {
    throw new Error("content:bundle:rollback requires --to-version <version>");
  }

  const prisma = new PrismaClient();
  try {
    const summary = await rollbackContentVersion(
      prisma,
      createObjectStorage(),
      targetVersion,
    );
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Content bundle rollback failed: ${message}\n`);
  process.exitCode = 1;
});
