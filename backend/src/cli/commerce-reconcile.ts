import "dotenv/config";
import { randomUUID } from "node:crypto";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "../app/app.module";
import { AppleReconciliationService } from "../modules/commerce/apple/apple-reconciliation.service";

/**
 * Asks Apple for the notifications it could not deliver, and applies them.
 *
 * A job rather than a request: it holds the App Store Server API key, it may
 * page for minutes, and nothing waits for its answer. Scheduled by the
 * workflow beside it, the same way every other periodic task in this
 * repository runs.
 *
 * Booted through the application context because what it needs is the whole
 * commerce module — the verifier, the notification path and the entitlement
 * ledger — and assembling that by hand here would be a second wiring of the
 * same graph.
 */
async function run(): Promise<void> {
  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  try {
    const reconciliation = context.get(AppleReconciliationService);
    if (!reconciliation.configured) {
      // Not a failure: a deployment ships before App Store Connect has an
      // app record, and a job that exited non-zero for that would page
      // somebody every hour about nothing.
      process.stdout.write(
        `${JSON.stringify({ skipped: "store-not-configured" })}\n`,
      );
      return;
    }
    const outcome = await reconciliation.run(randomUUID());
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
  } finally {
    await context.close();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
