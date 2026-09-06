import { ContentReleaseStatus, type PrismaClient } from "@prisma/client";

import type { ObjectStorage } from "../../../infrastructure/object-storage/object-storage";
import { assetBaseUrl } from "./bundle-assets";
import { sha256Hex, type LoadedBundle } from "./bundle-reader";
import { parseBundleDomain } from "./bundle-domain";
import { applyBundleToDatabase } from "./bundle-publisher";
import { lockActiveContentPointer } from "./content-pointer-lock";
import type { ContentManifest } from "./bundle-types";

export interface RollbackSummary {
  targetVersion: string;
  previousActiveVersion: string | null;
  alreadyActive: boolean;
  changes: number;
}

/**
 * Publish overwrites shared rows in place (entities, assets, revisions are
 * keyed by natural key, not by version), so flipping the pointer alone cannot
 * restore the target version's data. Rollback therefore re-reads the target
 * bundle from object storage — where every published bundle is immutably
 * stored — and re-applies it, checksum-verified against the manifest that was
 * recorded at publish time.
 */
async function loadBundleFromObjectStorage(
  objectStorage: ObjectStorage,
  manifest: ContentManifest,
): Promise<LoadedBundle> {
  const version = manifest.contentVersion;
  const filesByPath = new Map<string, Buffer>();
  for (const file of manifest.files) {
    const objectKey = `content-bundles/${version}/${file.path}`;
    const content = await objectStorage.getObject(objectKey);
    if (content === null) {
      throw new Error(
        `Bundle file ${objectKey} is missing from object storage; the release cannot be restored`,
      );
    }
    if (sha256Hex(content) !== file.sha256) {
      throw new Error(
        `Bundle file ${objectKey} does not match the checksum recorded at publish time`,
      );
    }
    filesByPath.set(file.path, content);
  }
  return {
    directory: `object-storage:content-bundles/${version}`,
    manifest,
    filesByPath,
  };
}

export async function rollbackContentVersion(
  prisma: PrismaClient,
  objectStorage: ObjectStorage,
  targetVersion: string,
): Promise<RollbackSummary> {
  const target = await prisma.contentRelease.findUnique({
    where: { version: targetVersion },
  });
  if (target === null) {
    throw new Error(`Content release ${targetVersion} does not exist`);
  }
  if (
    target.status !== ContentReleaseStatus.PUBLISHED &&
    target.status !== ContentReleaseStatus.RETIRED
  ) {
    throw new Error(
      `Content release ${targetVersion} has status ${target.status}; only a previously published version can be rolled back to`,
    );
  }

  const metadata = target.metadata as { manifest?: ContentManifest } | null;
  const manifest = metadata?.manifest;
  if (manifest === undefined) {
    throw new Error(
      `Content release ${targetVersion} has no stored manifest; it predates the bundle pipeline and cannot be restored`,
    );
  }

  const bundle = await loadBundleFromObjectStorage(objectStorage, manifest);
  const domain = parseBundleDomain(bundle);

  return prisma.$transaction(
    async (tx) => {
      // The same lock a publish takes, for the same reason: a rollback and a
      // publish both move the active pointer, and the emergency CLI path is
      // exactly the one nothing else would have coordinated with (ADR-017 §4).
      await lockActiveContentPointer(tx);

      const activePointer = await tx.contentPointer.findUnique({
        where: { key: "active" },
      });
      const previousActiveVersion = activePointer?.contentVersion ?? null;
      if (previousActiveVersion === targetVersion) {
        return {
          targetVersion,
          previousActiveVersion,
          alreadyActive: true,
          changes: 0,
        } satisfies RollbackSummary;
      }

      if (target.status === ContentReleaseStatus.RETIRED) {
        await tx.contentRelease.update({
          where: { version: targetVersion },
          data: { status: ContentReleaseStatus.PUBLISHED, retiredAt: null },
        });
      }

      // The assets of the restored release are still in this environment's
      // bucket, where its publish put them. Re-applying the bundle's own
      // address instead would point a recovered release back at somebody
      // else's CDN.
      const application = await applyBundleToDatabase(
        tx,
        bundle,
        domain,
        assetBaseUrl(objectStorage, targetVersion),
      );

      if (previousActiveVersion !== null) {
        await tx.contentRelease.update({
          where: { version: previousActiveVersion },
          data: { status: ContentReleaseStatus.RETIRED, retiredAt: new Date() },
        });
      }

      await tx.contentPointer.upsert({
        where: { key: "active" },
        create: { key: "active", contentVersion: targetVersion },
        update: { contentVersion: targetVersion },
      });

      await tx.auditEvent.create({
        data: {
          action: "content.rollback",
          targetType: "content_release",
          targetId: targetVersion,
          metadata: {
            previousActiveVersion,
            changeCount: application.changeCount,
          },
        },
      });

      return {
        targetVersion,
        previousActiveVersion,
        alreadyActive: false,
        changes: application.changeCount,
      } satisfies RollbackSummary;
    },
    { isolationLevel: "Serializable", maxWait: 30_000, timeout: 300_000 },
  );
}
