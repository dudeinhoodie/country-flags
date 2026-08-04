import {
  type AnswerMode,
  AssetStatus,
  type GradingMode,
  PublicationStatus,
  type Prisma,
} from "@prisma/client";

import { localeCandidates } from "../content/content-query";

export const CARD_SNAPSHOT_INCLUDE = {
  template: true,
  revisions: {
    where: { retiredAt: null },
    orderBy: { revision: "desc" },
    take: 1,
    include: { promptAsset: true },
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

function factDisplayValue(value: Prisma.JsonValue): string {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "displayValue" in value &&
    typeof value.displayValue === "string"
  ) {
    return value.displayValue;
  }

  return typeof value === "string" ? value : JSON.stringify(value);
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
    backSideFacts: card.subject.facts.map((fact) => ({
      type: fact.factType,
      displayValue: factDisplayValue(fact.value),
      observedAt:
        fact.observedAt === null
          ? null
          : fact.observedAt.toISOString().slice(0, 10),
      source: {
        name: fact.source.name,
        url: fact.source.url,
      },
    })),
    contentVersion: card.contentVersion,
  };
}
