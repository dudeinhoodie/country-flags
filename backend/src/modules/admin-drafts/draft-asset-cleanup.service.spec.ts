import { DraftAssetCleanupService } from "./draft-asset-cleanup.service";
import type { PrismaService } from "../../infrastructure/database/prisma.service";

function serviceWithReferences(keys: string[]): DraftAssetCleanupService {
  const database = {
    draftAsset: {
      findMany: () => Promise.resolve(keys.map((objectKey) => ({ objectKey }))),
    },
  } as unknown as PrismaService;
  return new DraftAssetCleanupService(database);
}

describe("DraftAssetCleanupService", () => {
  it("never treats a published bundle as deletable", () => {
    expect(
      DraftAssetCleanupService.isDeletableKey("content-bundles/2026.08.20/x"),
    ).toBe(false);
    expect(
      DraftAssetCleanupService.isDeletableKey("assets/svg/france.svg"),
    ).toBe(false);
    expect(
      DraftAssetCleanupService.isDeletableKey("drafts/abc/deadbeef.svg"),
    ).toBe(true);
  });

  it("deletes orphans, keeps what a draft still references", async () => {
    const service = serviceWithReferences(["drafts/live/kept.svg"]);
    const removed: string[] = [];
    const summary = await service.run(
      [
        "drafts/live/kept.svg",
        "drafts/dead/orphan.svg",
        "content-bundles/2026.08.20/manifest.json",
      ],
      async (key) => {
        removed.push(key);
        return Promise.resolve();
      },
    );

    expect(removed).toEqual(["drafts/dead/orphan.svg"]);
    expect(summary.deleted).toEqual(["drafts/dead/orphan.svg"]);
    expect(summary.keptReferenced).toBe(1);
    expect(summary.scanned).toBe(3);
  });

  it("is idempotent: a second run over what remains deletes nothing", async () => {
    const service = serviceWithReferences(["drafts/live/kept.svg"]);
    const removed: string[] = [];
    const remove = async (key: string): Promise<void> => {
      removed.push(key);
      return Promise.resolve();
    };
    await service.run(["drafts/live/kept.svg"], remove);
    await service.run(["drafts/live/kept.svg"], remove);
    expect(removed).toEqual([]);
  });
});
