import type { PrismaClient, PublishRun } from "@prisma/client";

import type { ObjectStorage } from "../../../infrastructure/object-storage/object-storage";
import { assetBaseUrl } from "../bundle/bundle-assets";
import { publishBundle } from "../bundle/bundle-publisher";
import {
  loadBundle,
  readManifest,
  writeManifest,
} from "../bundle/bundle-reader";
import { rollbackContentVersion } from "../bundle/bundle-rollback";
import {
  loadSigningPrivateKey,
  loadSigningPublicKeys,
  signManifest,
} from "../bundle/bundle-signer";
import { ContentPointerBusyError } from "../bundle/content-pointer-lock";
import { buildContentBundle, contentBuildPaths } from "./content-build";
import {
  PUBLISH_STAGES,
  PublishRunFailure,
  type ReleaseWork,
} from "./publish-run-executor";

/**
 * The three things a publish does, and the one thing a rollback does
 * (ADR-017 §1 and §5).
 *
 * The signing key is read here and nowhere else in this process, and the
 * process it is read in is the job — never the service that answers HTTP.
 * A rollback does not touch it at all: the release it returns to was signed
 * when it was published, and only the pointer moves.
 */
export class BundleReleaseWork implements ReleaseWork {
  constructor(
    private readonly database: PrismaClient,
    private readonly objectStorage: ObjectStorage,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async publish(
    run: PublishRun,
    stage: (stage: string) => Promise<void>,
  ): Promise<void> {
    if (run.minimumClientVersion === null) {
      // Not a defaulting decision to make here: what a release demands of a
      // client decides which installed apps keep working, and a publish run
      // without one was recorded wrong rather than left open.
      throw new PublishRunFailure(
        "PUBLISH_RUN_INCOMPLETE",
        "This run carries no minimum client version, so there is no release to build",
      );
    }

    await stage(PUBLISH_STAGES.building);
    const bundleDirectory = await this.guard(
      "PUBLISH_RUN_BUILD_FAILED",
      buildContentBundle(
        {
          contentVersion: run.contentVersion,
          minimumClientVersion: run.minimumClientVersion,
          // Where this environment actually serves the files from, asked of
          // the same storage the upload will use — so the address a release
          // records and the place its bytes land cannot drift apart.
          assetBaseUrl: assetBaseUrl(this.objectStorage, run.contentVersion),
        },
        contentBuildPaths(this.env),
      ),
    );

    await stage(PUBLISH_STAGES.signing);
    await this.guard("PUBLISH_RUN_SIGNING_FAILED", this.sign(bundleDirectory));

    await stage(PUBLISH_STAGES.applying);
    await this.guard(
      "PUBLISH_RUN_APPLY_FAILED",
      publishBundle(
        bundleDirectory,
        loadSigningPublicKeys(this.env),
        this.database,
        this.objectStorage,
      ),
    );
  }

  async rollback(
    run: PublishRun,
    stage: (stage: string) => Promise<void>,
  ): Promise<void> {
    await stage(PUBLISH_STAGES.restoring);
    await this.guard(
      "PUBLISH_RUN_ROLLBACK_FAILED",
      rollbackContentVersion(
        this.database,
        this.objectStorage,
        run.contentVersion,
      ),
    );
  }

  /**
   * Signs the manifest in place, the way the CLI does.
   *
   * The bundle is signed after it is built and before it is applied, because
   * the publisher verifies the signature it finds — the same check a client
   * makes, made by the process that has just produced the file, so a bundle
   * that cannot be verified never reaches the database.
   */
  private async sign(bundleDirectory: string): Promise<void> {
    const { keyId, privateKeyPem } = loadSigningPrivateKey(this.env);
    const manifest = await readManifest(bundleDirectory);
    manifest.signature = signManifest(manifest, privateKeyPem, keyId);
    await writeManifest(bundleDirectory, manifest);
    // Reading it straight back is the cheap proof that what was written is
    // what will be published, rather than trusting the object in memory.
    await loadBundle(bundleDirectory);
  }

  /**
   * Gives a failure the code of the step it happened in, unless it already
   * carries a better one.
   *
   * Losing the pointer lock is the one failure that is not this run's fault
   * and is worth saying out loud: it means something else is mid-release,
   * and the answer is to wait rather than to investigate.
   */
  private async guard<T>(code: string, work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error: unknown) {
      if (error instanceof PublishRunFailure) {
        throw error;
      }
      if (error instanceof ContentPointerBusyError) {
        throw new PublishRunFailure("PUBLISH_RUN_POINTER_BUSY", error.message);
      }
      throw new PublishRunFailure(
        code,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
