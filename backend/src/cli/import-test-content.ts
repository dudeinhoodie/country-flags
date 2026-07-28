import "reflect-metadata";

import { PrismaClient } from "@prisma/client";

import { importTestContent } from "../modules/content/import/test-content-importer";

async function run(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("TEST_ONLY content import is disabled in production");
  }

  const prisma = new PrismaClient();
  try {
    const summary = await importTestContent(prisma);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Content fixture import failed: ${message}\n`);
  process.exitCode = 1;
});
