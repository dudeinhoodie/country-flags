import {
  ContentResourceType,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import type { BundleDomain } from "./bundle-domain";

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface ResourceChangeSet {
  resourceType: ContentResourceType;
  upsertedKeys: string[];
  retiredKeys: string[];
}

export interface BundleDiff {
  previousActiveVersion: string | null;
  resourceChanges: ResourceChangeSet[];
}

function diffKeys(
  previousKeys: string[],
  nextKeys: string[],
): {
  upsertedKeys: string[];
  retiredKeys: string[];
} {
  const nextKeySet = new Set(nextKeys);
  return {
    upsertedKeys: [...nextKeySet],
    retiredKeys: previousKeys.filter((key) => !nextKeySet.has(key)),
  };
}

export async function getActiveContentVersion(
  prisma: DbClient,
): Promise<string | null> {
  const pointer = await prisma.contentPointer.findUnique({
    where: { key: "active" },
  });
  return pointer?.contentVersion ?? null;
}

/**
 * Every resource key present in the new bundle is treated as an UPSERT, even if unchanged —
 * there is no per-resource content hash to distinguish "unchanged" from "changed" cheaply, and
 * re-announcing an unchanged resource on the change feed is safe (clients just re-fetch it).
 */
export async function diffBundleAgainstActive(
  prisma: DbClient,
  domain: BundleDomain,
): Promise<BundleDiff> {
  const previousActiveVersion = await getActiveContentVersion(prisma);

  const previousEntityKeys =
    previousActiveVersion === null
      ? []
      : (
          await prisma.geoEntity.findMany({
            where: { contentVersion: previousActiveVersion },
            select: { contentKey: true },
          })
        ).map((row) => row.contentKey);

  const previousAssetKeys =
    previousActiveVersion === null
      ? []
      : (
          await prisma.asset.findMany({
            where: { contentVersion: previousActiveVersion },
            select: { objectKey: true },
          })
        ).map((row) => row.objectKey);

  const previousDeckKeys =
    previousActiveVersion === null
      ? []
      : (
          await prisma.deck.findMany({
            where: { contentVersion: previousActiveVersion },
            select: { code: true },
          })
        ).map((row) => row.code);

  const previousLearningCardKeys =
    previousActiveVersion === null
      ? []
      : (
          await prisma.learningCard.findMany({
            where: { contentVersion: previousActiveVersion },
            select: {
              semanticVersion: true,
              subject: { select: { contentKey: true } },
              template: { select: { code: true } },
            },
          })
        ).map(
          (row) =>
            `${row.subject.contentKey}:${row.template.code}:${String(row.semanticVersion)}`,
        );

  const nextEntityKeys = domain.catalog.entities.map((e) => e.key);
  const nextAssetKeys = domain.assets.map((a) => a.key);
  const nextDeckKeys = domain.catalog.decks.map((d) => d.key);
  const nextLearningCardKeys = domain.learningCards.map(
    (c) => `${c.entityKey}:${c.templateCode}:${String(c.semanticVersion)}`,
  );

  const resourceChanges: ResourceChangeSet[] = [
    {
      resourceType: ContentResourceType.ENTITY,
      ...diffKeys(previousEntityKeys, nextEntityKeys),
    },
    {
      resourceType: ContentResourceType.ASSET,
      ...diffKeys(previousAssetKeys, nextAssetKeys),
    },
    {
      resourceType: ContentResourceType.DECK,
      ...diffKeys(previousDeckKeys, nextDeckKeys),
    },
    {
      resourceType: ContentResourceType.LEARNING_CARD,
      ...diffKeys(previousLearningCardKeys, nextLearningCardKeys),
    },
  ];

  return { previousActiveVersion, resourceChanges };
}
