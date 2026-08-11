import {
  type AnswerMode,
  AssetStatus,
  type GradingMode,
  PublicationStatus,
  type Prisma,
} from "@prisma/client";

import {
  ASSET_REPRESENTATIONS_INCLUDE,
  mapAssetRepresentations,
} from "../content/asset-representations";
import { localeCandidates } from "../content/content-query";
import { mapBackSideFacts } from "../content/fact-display";

export const CARD_SNAPSHOT_INCLUDE = {
  template: true,
  revisions: {
    where: { retiredAt: null },
    orderBy: { revision: "desc" },
    take: 1,
    include: { promptAsset: { include: ASSET_REPRESENTATIONS_INCLUDE } },
  },
  subject: {
    include: {
      names: true,
      facts: {
        where: { status: PublicationStatus.PUBLISHED },
        include: { source: true },
        orderBy: [{ factType: "asc" }, { id: "asc" }],
      },
    },
  },
} satisfies Prisma.LearningCardInclude;

export type SnapshotLearningCard = Prisma.LearningCardGetPayload<{
  include: typeof CARD_SNAPSHOT_INCLUDE;
}>;

/**
 * Server selection always snapshots the current revision, so it loads only
 * that one. An offline import instead pins the revision the client actually
 * studied, which requires every live revision to be available for lookup.
 */
export const CARD_SNAPSHOT_ALL_REVISIONS_INCLUDE = {
  ...CARD_SNAPSHOT_INCLUDE,
  revisions: {
    where: { retiredAt: null },
    orderBy: { revision: "desc" },
    include: { promptAsset: { include: ASSET_REPRESENTATIONS_INCLUDE } },
  },
} satisfies Prisma.LearningCardInclude;

export type LiveRevisionsLearningCard = Prisma.LearningCardGetPayload<{
  include: typeof CARD_SNAPSHOT_ALL_REVISIONS_INCLUDE;
}>;

export function pinRevision(
  card: LiveRevisionsLearningCard,
  revision: LiveRevisionsLearningCard["revisions"][number],
): SnapshotLearningCard {
  return { ...card, revisions: [revision] };
}

function selectEntityName(
  card: SnapshotLearningCard,
  candidates: string[],
): { value: string; locale: string } {
  for (const candidate of candidates) {
    const name = card.subject.names.find(
      ({ locale, isPrimary }) =>
        isPrimary && locale.toLowerCase() === candidate,
    );
    if (name !== undefined) {
      return name;
    }
  }
  throw new Error(
    `Published entity ${card.subject.id} has no fallback localized name`,
  );
}

export function buildLearningCardSnapshot(
  card: SnapshotLearningCard,
  requestedLocale: string,
  defaultLocale: string,
  answerMode: AnswerMode | GradingMode = card.template.gradingMode,
): Record<string, unknown> {
  const revision = card.revisions[0];
  if (revision?.promptAsset === null || revision === undefined) {
    throw new Error(`Learning card ${card.id} has no active prompt asset`);
  }
  if (revision.promptAsset.status !== AssetStatus.PUBLISHED) {
    throw new Error(
      `Learning card ${card.id} references an unpublished prompt asset`,
    );
  }

  const candidates = localeCandidates(requestedLocale, defaultLocale);
  const entityName = selectEntityName(card, candidates);
  const aliases = card.subject.names
    .filter(
      (name) =>
        candidates.includes(name.locale.toLowerCase()) &&
        name.value !== entityName.value,
    )
    .map(({ value }) => value)
    .filter((value, index, values) => values.indexOf(value) === index);
  const asset = revision.promptAsset;

  return {
    id: card.id,
    templateCode: card.template.code,
    templateSchemaVersion: card.template.schemaVersion,
    semanticVersion: card.semanticVersion,
    revision: revision.revision,
    answerMode,
    prompt: {
      asset: {
        id: asset.id,
        type: asset.assetType,
        url: asset.publicUrl,
        mimeType: asset.mimeType,
        sha256: asset.sha256,
        representations: mapAssetRepresentations(asset),
        width: asset.width,
        height: asset.height,
        aspectRatio:
          asset.aspectRatio === null ? null : asset.aspectRatio.toNumber(),
        licenseName: asset.licenseName,
        attribution: asset.attribution,
      },
    },
    answer: {
      entityId: card.subject.id,
      displayName: entityName.value,
      aliases,
    },
    backSideFacts: mapBackSideFacts(card.subject.facts, requestedLocale),
    contentVersion: card.contentVersion,
  };
}
