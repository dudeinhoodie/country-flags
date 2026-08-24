import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infrastructure/database/prisma.service";

export interface CleanupSummary {
  scanned: number;
  deleted: string[];
  keptReferenced: number;
}

/**
 * Removes draft objects nothing points at any more.
 *
 * Two rules make this safe to run unattended:
 *
 * 1. It only ever considers keys under `drafts/`, so a published bundle is
 *    outside its world entirely. Rollback reads the bundle of a target
 *    version straight from object storage, and a cleanup job that could
 *    reach `content-bundles/<version>/` would be a job that can make a
 *    release unrecoverable.
 * 2. A key still referenced by a DraftAsset row is kept regardless of age.
 *
 * It is idempotent: running it twice deletes nothing the second time.
 */
@Injectable()
export class DraftAssetCleanupService {
  constructor(private readonly database: PrismaService) {}

  static isDeletableKey(key: string): boolean {
    return key.startsWith("drafts/") && !key.includes("content-bundles/");
  }

  async run(
    candidateKeys: string[],
    remove: (key: string) => Promise<void>,
  ): Promise<CleanupSummary> {
    const referenced = new Set(
      (
        await this.database.draftAsset.findMany({
          select: { objectKey: true },
        })
      ).map(({ objectKey }) => objectKey),
    );
    const deleted: string[] = [];
    let keptReferenced = 0;
    for (const key of candidateKeys) {
      if (referenced.has(key)) {
        keptReferenced += 1;
        continue;
      }
      if (!DraftAssetCleanupService.isDeletableKey(key)) {
        continue;
      }
      await remove(key);
      deleted.push(key);
    }
    return { scanned: candidateKeys.length, deleted, keptReferenced };
  }
}
