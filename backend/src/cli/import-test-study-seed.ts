import "reflect-metadata";
import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import { importTestContent } from "../modules/content/import/test-content-importer";
import { importTestStudySeed } from "../modules/study-sessions/import/test-study-seed-importer";

async function run(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("TEST_ONLY study seed is disabled in production");
  }

  const prisma = new PrismaClient();
  try {
    await importTestContent(prisma);
    const summary = await importTestStudySeed(prisma);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Study seed import failed: ${message}\n`);
  process.exitCode = 1;
});
