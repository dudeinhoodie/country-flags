import { createHash } from "node:crypto";

import type { GeoEntityKind } from "@prisma/client";

import { localeCandidates } from "../content/content-query";

export const DISTRACTOR_POLICY_VERSION = "mvp-distractors-v1";

interface EntityName {
  locale: string;
  value: string;
  isPrimary: boolean;
}

export interface DistractorPoolEntity {
  id: string;
  kind: GeoEntityKind;
  names: EntityName[];
}

export interface GeneratedStudyOption {
  id: string;
  position: number;
  answerEntityId: string;
  displaySnapshot: {
    entityId: string;
    displayName: string;
    locale: string;
    distractorPolicyVersion: string;
    poolVersion: string;
  };
  isCorrect: boolean;
}

export interface MultipleChoiceOptionSet {
  distractorPolicyVersion: string;
  options: GeneratedStudyOption[];
}

function deterministicRank(seed: string, value: string): string {
  return createHash("sha256").update(`${seed}:${value}`).digest("hex");
}

function deterministicUuid(seed: string): string {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function normalizedDisplayName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function localizedName(
  entity: DistractorPoolEntity,
  requestedLocale: string,
  defaultLocale: string,
): { displayName: string; locale: string } | null {
  for (const locale of localeCandidates(requestedLocale, defaultLocale)) {
    const name = entity.names.find(
      (candidate) =>
        candidate.isPrimary && candidate.locale.toLowerCase() === locale,
    );
    if (name !== undefined) {
      return { displayName: name.value, locale: name.locale };
    }
  }
  return null;
}

export function generateMultipleChoiceOptions(input: {
  sessionCardId: string;
  correctEntityId: string;
  correctEntityKind: GeoEntityKind;
  requestedLocale: string;
  defaultLocale: string;
  randomSeed: string;
  poolVersion: string;
  pool: DistractorPoolEntity[];
}): MultipleChoiceOptionSet | null {
  const localized = input.pool
    .filter(({ kind }) => kind === input.correctEntityKind)
    .map((entity) => ({
      entity,
      name: localizedName(entity, input.requestedLocale, input.defaultLocale),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        entity: DistractorPoolEntity;
        name: { displayName: string; locale: string };
      } => candidate.name !== null,
    );
  const correct = localized.find(
    ({ entity }) => entity.id === input.correctEntityId,
  );
  if (correct === undefined) {
    return null;
  }

  const usedNames = new Set([normalizedDisplayName(correct.name.displayName)]);
  const distractors = localized
    .filter(({ entity }) => entity.id !== input.correctEntityId)
    .sort((left, right) =>
      deterministicRank(input.randomSeed, left.entity.id).localeCompare(
        deterministicRank(input.randomSeed, right.entity.id),
      ),
    )
    .filter(({ name }) => {
      const normalized = normalizedDisplayName(name.displayName);
      if (usedNames.has(normalized)) {
        return false;
      }
      usedNames.add(normalized);
      return true;
    })
    .slice(0, 3);
  if (distractors.length !== 3) {
    return null;
  }

  const distractorPolicyVersion = `${DISTRACTOR_POLICY_VERSION}@${input.poolVersion}`;
  return {
    distractorPolicyVersion,
    options: [correct, ...distractors]
      .sort((left, right) =>
        deterministicRank(
          `${input.randomSeed}:order`,
          left.entity.id,
        ).localeCompare(
          deterministicRank(`${input.randomSeed}:order`, right.entity.id),
        ),
      )
      .map(({ entity, name }, position) => ({
        id: deterministicUuid(`${input.sessionCardId}:option:${entity.id}`),
        position,
        answerEntityId: entity.id,
        displaySnapshot: {
          entityId: entity.id,
          displayName: name.displayName,
          locale: name.locale,
          distractorPolicyVersion,
          poolVersion: input.poolVersion,
        },
        isCorrect: entity.id === input.correctEntityId,
      })),
  };
}
