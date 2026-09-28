import {
  ContentResourceType,
  DeckKind,
  DeckStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import type { BundleDomain } from "./bundle-domain";
import { deckCodeFromKey } from "./bundle-mapper";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * What changes for one kind of resource, named by the natural key its row is
 * found by: an entity's content key, an asset's object key, a deck's code and
 * a learning card's `entity:template:semanticVersion`.
 *
 * Both sides of a diff have to be in that one alphabet. A deck is named
 * `deck.europe` in the catalogue and `EUROPE` in the database, and comparing
 * the one with the other retired nothing: every stored code looked dropped,
 * none could be found again by the key it was mistaken for, and a deck
 * removed from the catalogue stayed published for good (#440).
 */
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

  // Every catalogue deck still being served rather than only the active
  // version's: a deck dropped while retirement was broken is still PUBLISHED
  // under the release that last carried it, and only the next publish is
  // going to retire it. A person's own deck is not the catalogue's to
  // retire, whatever a release leaves out; `decks_owner_check` ties an owner
  // to exactly the kinds left out here.
  const previousDeckCodes =
    previousActiveVersion === null
      ? []
      : (
          await prisma.deck.findMany({
            where: {
              status: DeckStatus.PUBLISHED,
              kind: { in: [DeckKind.CURATED, DeckKind.TAXONOMY] },
            },
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
  const nextDeckCodes = domain.catalog.decks.map((d) => deckCodeFromKey(d.key));
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
      ...diffKeys(previousDeckCodes, nextDeckCodes),
    },
    {
      resourceType: ContentResourceType.LEARNING_CARD,
      ...diffKeys(previousLearningCardKeys, nextLearningCardKeys),
    },
  ];

  return { previousActiveVersion, resourceChanges };
}
