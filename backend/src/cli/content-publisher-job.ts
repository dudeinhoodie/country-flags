import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import { createObjectStorage } from "../infrastructure/object-storage/create-object-storage";
import { loadObjectStorageConfig } from "../infrastructure/object-storage/object-storage.config";
import { PrismaPublishRunStore } from "../modules/content/publisher/prisma-publish-run-store";
import { executePublishRun } from "../modules/content/publisher/publish-run-executor";
import { BundleReleaseWork } from "../modules/content/publisher/release-work";

/**
 * The publisher job (ADR-017).
 *
 * The console cannot publish: applying a release is a Serializable
 * transaction allowed twenty minutes, and no HTTP request lives that long.
 * So the request records a run and this process carries it out, under its
 * own service account, with a direct database connection and the signing key
 * that the service answering HTTP never sees.
 *
 * It is the same image the API runs — one build, one digest to promote —
 * started with a different command.
 *
 * Exit codes matter here: Cloud Run reports a non-zero task as a failed
 * execution, and an operator reads that before they read anything of ours.
 * Finding nothing to take is a zero: a job started twice for one run, or
 * started for a run somebody cancelled meanwhile, has done its job by
 * leaving it alone.
 */
function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  // The run is named by the execution that was started for it. Without one,
  // the job drains whatever is queued — which is how an operator gets a
  // stuck queue moving with `gcloud run jobs execute` and no arguments.
  const runId = nonEmpty(
    option(args, "--run-id") ?? process.env.PUBLISH_RUN_ID,
  );
  const executionName = nonEmpty(process.env.CLOUD_RUN_EXECUTION);

  if (loadObjectStorageConfig().provider === "memory") {
    throw new Error(
      "OBJECT_STORAGE_PROVIDER=memory would record the release in the database while the uploaded bundle files vanish when this process exits. The publisher job requires the S3/MinIO provider.",
    );
  }

  const database = new PrismaClient();
  try {
    const outcome = await executePublishRun(
      new PrismaPublishRunStore(database),
      new BundleReleaseWork(database, createObjectStorage()),
      { runId, executionName },
    );
    if (!outcome.taken) {
      process.stdout.write(
        `${runId === undefined ? "No release run is queued" : `Release run ${runId} is not queued`}; nothing to do\n`,
      );
      return;
    }
    if (!outcome.succeeded) {
      // The reason is on the row, where the console reads it; this is the
      // signal Cloud Run itself reports.
      throw new Error(
        `Release run ${outcome.run.id} (${outcome.run.kind} ${outcome.run.contentVersion}) failed`,
      );
    }
    process.stdout.write(
      `Release run ${outcome.run.id} (${outcome.run.kind} ${outcome.run.contentVersion}) succeeded\n`,
    );
  } finally {
    await database.$disconnect();
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Content publisher job failed: ${message}\n`);
  process.exitCode = 1;
});
