import { createHash } from "node:crypto";

import {
  AssetStatus,
  CardStatus,
  ContentChangeOperation,
  ContentReleaseStatus,
  ContentResourceType,
  DeckKind,
  DeckStatus,
  GeoEntityStatus,
  GeoNameType,
  PublicationStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import type { ObjectStorage } from "../../../infrastructure/object-storage/object-storage";
import { assetBaseUrl, uploadBundleAssets } from "./bundle-assets";
import type { LoadedBundle } from "./bundle-reader";
import { validateBundle } from "./bundle-validator";
import { diffBundleAgainstActive, type BundleDiff } from "./bundle-diff";
import type { BundleDomain, DomainAsset } from "./bundle-domain";
import * as mapper from "./bundle-mapper";

export interface PublishSummary {
  version: string;
  previousActiveVersion: string | null;
  alreadyPublished: boolean;
  counts: {
    entities: number;
    assets: number;
    decks: number;
    cardTemplates: number;
    learningCards: number;
    facts: number;
    changes: number;
  };
}

async function uploadBundleFiles(
  bundle: LoadedBundle,
  objectStorage: ObjectStorage,
): Promise<void> {
  for (const file of bundle.manifest.files) {
    const content = bundle.filesByPath.get(file.path);
    if (content === undefined) {
      continue;
    }
    const objectKey = `content-bundles/${bundle.manifest.contentVersion}/${file.path}`;
    if (!(await objectStorage.objectExists(objectKey, file.sha256))) {
      await objectStorage.putObject(objectKey, content, "application/json");
    }
  }
}

interface ResolvedIds {
  entityIdByKey: Map<string, string>;
  assetIdByKey: Map<string, string>;
  templateIdByKey: Map<string, string>;
  learningCardIdByKey: Map<string, string>;
  activeCardIdByEntityKey: Map<string, string>;
  deckIdByKey: Map<string, string>;
}

async function upsertSources(
  tx: Prisma.TransactionClient,
  domain: BundleDomain,
): Promise<Map<string, string>> {
  const sourceKeys = new Set<string>(["catalog"]);
  for (const asset of domain.assets) {
    sourceKeys.add(asset.provenance.sourceKey);
  }
  for (const collection of domain.facts) {
    for (const record of collection.records) {
      if (record.provenance !== undefined) {
        sourceKeys.add(record.provenance.sourceKey);
      }
    }
  }

  const sourceIdByKey = new Map<string, string>();
  for (const sourceKey of sourceKeys) {
    const id = mapper.sourceIdForKey(sourceKey);
    const meta = mapper.resolveSourceMetadata(sourceKey);
    await tx.source.upsert({
      where: { id },
      create: {
        id,
        name: meta.name,
        url: meta.url,
        licenseName: meta.licenseName,
        retrievedAt: new Date(),
        metadata: { sourceKey },
      },
      update: {
        name: meta.name,
        url: meta.url,
        licenseName: meta.licenseName,
        metadata: { sourceKey },
      },
    });
    sourceIdByKey.set(sourceKey, id);
  }
  return sourceIdByKey;
}

async function upsertEntities(
  tx: Prisma.TransactionClient,
  domain: BundleDomain,
  version: string,
  catalogSourceId: string,
): Promise<Map<string, string>> {
  const entityIdByKey = new Map<string, string>();
  for (const entity of domain.catalog.entities) {
    const row = await tx.geoEntity.upsert({
      where: { contentKey: entity.key },
      create: {
        contentKey: entity.key,
        kind: mapper.mapEntityKind(entity.type),
        slug: mapper.slugFromEntityKey(entity.key),
        isoAlpha2: entity.codes?.isoAlpha2 ?? null,
        isoAlpha3: entity.codes?.isoAlpha3 ?? null,
        m49Code: entity.codes?.m49 ?? null,
        customCode: entity.codes?.customCode ?? null,
        status: mapper.mapEntityStatus(entity.status),
        includeInCountryCatalog: entity.includeInCountryCatalog,
        recognitionStatus: mapper.mapRecognitionStatus(
          entity.recognition.status,
        ),
        metadata: {} satisfies Prisma.InputJsonObject,
        contentVersion: version,
      },
      update: {
        kind: mapper.mapEntityKind(entity.type),
        isoAlpha2: entity.codes?.isoAlpha2 ?? null,
        isoAlpha3: entity.codes?.isoAlpha3 ?? null,
        m49Code: entity.codes?.m49 ?? null,
        customCode: entity.codes?.customCode ?? null,
        status: mapper.mapEntityStatus(entity.status),
        includeInCountryCatalog: entity.includeInCountryCatalog,
        recognitionStatus: mapper.mapRecognitionStatus(
          entity.recognition.status,
        ),
        contentVersion: version,
      },
    });
    entityIdByKey.set(entity.key, row.id);

    for (const [locale, localizedName] of Object.entries(entity.names)) {
      await tx.geoEntityName.upsert({
        where: {
          geoEntityId_locale_nameType_value: {
            geoEntityId: row.id,
            locale,
            nameType: GeoNameType.SHORT,
            value: localizedName.short,
          },
        },
        create: {
          geoEntityId: row.id,
          locale,
          nameType: GeoNameType.SHORT,
          value: localizedName.short,
          isPrimary: true,
          sourceId: catalogSourceId,
        },
        update: { isPrimary: true },
      });
      // The unique key includes the value, so a rename inserts a new row —
      // demote any other primary SHORT name left over from a previous bundle.
      await tx.geoEntityName.updateMany({
        where: {
          geoEntityId: row.id,
          locale,
          nameType: GeoNameType.SHORT,
          isPrimary: true,
          value: { not: localizedName.short },
        },
        data: { isPrimary: false },
      });
    }
  }
  return entityIdByKey;
}

async function upsertRelations(
  tx: Prisma.TransactionClient,
  domain: BundleDomain,
  entityIdByKey: Map<string, string>,
): Promise<void> {
  for (const relation of domain.catalog.relations) {
    const parentEntityId = entityIdByKey.get(relation.parentKey);
    const childEntityId = entityIdByKey.get(relation.childKey);
    if (parentEntityId === undefined || childEntityId === undefined) {
      continue;
    }
    const relationType = mapper.mapRelationType(relation.relationType);
    const metadata = {
      primary: relation.primary,
    } satisfies Prisma.InputJsonObject;
    // Prisma's compound-unique where-input rejects `null` for the nullable validFrom
    // column, so this identity lookup uses findFirst instead of upsert-by-unique.
    const existingRelation = await tx.geoRelation.findFirst({
      where: {
        parentEntityId,
        childEntityId,
        taxonomyCode: relation.taxonomyKey,
        relationType,
        validFrom: null,
      },
      select: { id: true },
    });
    if (existingRelation === null) {
      await tx.geoRelation.create({
        data: {
          parentEntityId,
          childEntityId,
          taxonomyCode: relation.taxonomyKey,
          relationType,
          metadata,
        },
      });
    } else {
      await tx.geoRelation.update({
        where: { id: existingRelation.id },
        data: { metadata },
      });
    }
  }
}

async function upsertAssets(
  tx: Prisma.TransactionClient,
  domain: BundleDomain,
  version: string,
  entityIdByKey: Map<string, string>,
  sourceIdByKey: Map<string, string>,
  assetBaseUrl: string,
): Promise<Map<string, string>> {
  const assetIdByKey = new Map<string, string>();
  for (const asset of domain.assets) {
    const geoEntityId = entityIdByKey.get(asset.entityKey);
    if (geoEntityId === undefined) {
      continue;
    }
    const sourceId =
      sourceIdByKey.get(asset.provenance.sourceKey) ??
      mapper.sourceIdForKey(asset.provenance.sourceKey);
    const row = await tx.asset.upsert({
      where: { objectKey: asset.key },
      create: {
        geoEntityId,
        assetType: mapper.mapAssetType(),
        variant: "current",
        objectKey: asset.key,
        publicUrl: `${assetBaseUrl}${asset.path}`,
        mimeType: asset.mimeType,
        sha256: asset.sha256,
        aspectRatio: asset.aspectRatio ?? null,
        sourceId,
        licenseName: asset.license,
        licenseUrl: null,
        attribution: asset.attribution ?? null,
        status: mapper.mapAssetStatus(),
        contentVersion: version,
      },
      update: {
        geoEntityId,
        publicUrl: `${assetBaseUrl}${asset.path}`,
        sha256: asset.sha256,
        aspectRatio: asset.aspectRatio ?? null,
        sourceId,
        licenseName: asset.license,
        attribution: asset.attribution ?? null,
        contentVersion: version,
      },
    });
    await replaceRepresentations(tx, row.id, asset, assetBaseUrl);
    assetIdByKey.set(asset.key, row.id);
  }
  return assetIdByKey;
}

/**
 * The representation list is the release's, not an accumulation across
 * releases: a republish that drops a scale must drop it here too, or a client
 * would keep preferring a file the release no longer serves.
 */
async function replaceRepresentations(
  tx: Prisma.TransactionClient,
  assetId: string,
  asset: DomainAsset,
  assetBaseUrl: string,
): Promise<void> {
  await tx.assetRepresentation.deleteMany({ where: { assetId } });
  await tx.assetRepresentation.createMany({
    data: asset.representations.map((representation, index) => ({
      assetId,
      sortOrder: index,
      publicUrl: `${assetBaseUrl}${representation.path}`,
      mimeType: representation.mimeType,
      sha256: representation.sha256,
      scale: representation.scale ?? null,
      widthPx: representation.widthPx ?? null,
      heightPx: representation.heightPx ?? null,
    })),
  });
}

async function upsertCardTemplates(
  tx: Prisma.TransactionClient,
  domain: BundleDomain,
): Promise<Map<string, string>> {
  const templateIdByKey = new Map<string, string>();
  for (const template of domain.cardTemplates) {
    const row = await tx.cardTemplate.upsert({
      where: {
        code_schemaVersion: {
          code: template.code,
          schemaVersion: template.schemaVersion,
        },
      },
      create: {
        code: template.code,
        schemaVersion: template.schemaVersion,
        promptType: template.promptType,
        answerType: template.answerType,
        gradingMode: mapper.mapGradingMode(template.gradingMode),
        promptSpec: template.promptSpec as Prisma.InputJsonValue,
        answerSpec: template.answerSpec as Prisma.InputJsonValue,
        backSideFactTypes: mapper.mapBackSideFactTypes(
          template.backSideFactTypes,
        ),
        status: mapper.mapPublicationStatus(template.status),
      },
      update: {
        promptType: template.promptType,
        answerType: template.answerType,
        gradingMode: mapper.mapGradingMode(template.gradingMode),
        promptSpec: template.promptSpec as Prisma.InputJsonValue,
        answerSpec: template.answerSpec as Prisma.InputJsonValue,
        backSideFactTypes: mapper.mapBackSideFactTypes(
          template.backSideFactTypes,
        ),
        status: mapper.mapPublicationStatus(template.status),
      },
    });
    templateIdByKey.set(
      `${template.code}:${String(template.schemaVersion)}`,
      row.id,
    );
  }
  return templateIdByKey;
}

async function upsertLearningCards(
  tx: Prisma.TransactionClient,
  domain: BundleDomain,
  version: string,
  entityIdByKey: Map<string, string>,
  templateIdByKey: Map<string, string>,
  assetIdByKey: Map<string, string>,
): Promise<{
  learningCardIdByKey: Map<string, string>;
  activeCardIdByEntityKey: Map<string, string>;
}> {
  const learningCardIdByKey = new Map<string, string>();
  const activeCardIdByEntityKey = new Map<string, string>();

  const orderedCards = [...domain.learningCards].sort(
    (left, right) => left.semanticVersion - right.semanticVersion,
  );

  for (const card of orderedCards) {
    const subjectEntityId = entityIdByKey.get(card.entityKey);
    const templateId = templateIdByKey.get(
      `${card.templateCode}:${String(card.templateSchemaVersion)}`,
    );
    if (subjectEntityId === undefined || templateId === undefined) {
      continue;
    }

    const supersedesLearningCardId =
      card.supersedesSemanticVersion === null
        ? null
        : (learningCardIdByKey.get(
            `${card.entityKey}:${card.templateCode}:${String(card.supersedesSemanticVersion)}`,
          ) ?? null);

    const row = await tx.learningCard.upsert({
      where: {
        subjectEntityId_templateId_semanticVersion: {
          subjectEntityId,
          templateId,
          semanticVersion: card.semanticVersion,
        },
      },
      create: {
        subjectEntityId,
        templateId,
        semanticVersion: card.semanticVersion,
        supersedesLearningCardId,
        status: mapper.mapCardStatus(card.status),
        contentVersion: version,
      },
      update: {
        supersedesLearningCardId,
        status: mapper.mapCardStatus(card.status),
        contentVersion: version,
      },
    });
    const cardKey = `${card.entityKey}:${card.templateCode}:${String(card.semanticVersion)}`;
    learningCardIdByKey.set(cardKey, row.id);
    if (card.status === "active") {
      activeCardIdByEntityKey.set(card.entityKey, row.id);
    }

    for (const revision of card.revisions) {
      const promptAssetId =
        revision.promptAssetKey === null
          ? null
          : (assetIdByKey.get(revision.promptAssetKey) ?? null);
      await tx.learningCardRevision.upsert({
        where: {
          learningCardId_revision: {
            learningCardId: row.id,
            revision: revision.revision,
          },
        },
        create: {
          learningCardId: row.id,
          revision: revision.revision,
          promptAssetId,
          promptFingerprint: revision.promptFingerprint,
          changeClassification: mapper.mapChangeClassification(
            revision.changeClassification,
          ),
          progressPolicy: mapper.mapProgressPolicy(),
          contentVersion: version,
          effectiveFrom: new Date(revision.effectiveFrom),
          retiredAt:
            revision.retiredAt === null ? null : new Date(revision.retiredAt),
        },
        update: {
          promptAssetId,
          promptFingerprint: revision.promptFingerprint,
          changeClassification: mapper.mapChangeClassification(
            revision.changeClassification,
          ),
          contentVersion: version,
          effectiveFrom: new Date(revision.effectiveFrom),
          retiredAt:
            revision.retiredAt === null ? null : new Date(revision.retiredAt),
        },
      });
    }
  }

  return { learningCardIdByKey, activeCardIdByEntityKey };
}

async function upsertDecks(
  tx: Prisma.TransactionClient,
  domain: BundleDomain,
  version: string,
  activeCardIdByEntityKey: Map<string, string>,
): Promise<Map<string, string>> {
  const deckIdByKey = new Map<string, string>();
  for (const deck of domain.catalog.decks) {
    // The catalogue names a deck once, in its own alphabet; the contract serves
    // it in another. Validation has already refused a key this cannot express.
    const code = mapper.deckCodeFromKey(deck.key);
    const row = await tx.deck.upsert({
      where: { code },
      create: {
        code,
        kind: deck.kind === "curated" ? DeckKind.CURATED : DeckKind.TAXONOMY,
        status: DeckStatus.PUBLISHED,
        contentVersion: version,
      },
      update: {
        kind: deck.kind === "curated" ? DeckKind.CURATED : DeckKind.TAXONOMY,
        status: DeckStatus.PUBLISHED,
        contentVersion: version,
      },
    });
    deckIdByKey.set(deck.key, row.id);

    for (const [locale, localized] of Object.entries(deck.names)) {
      await tx.deckLocalization.upsert({
        where: { deckId_locale: { deckId: row.id, locale } },
        create: {
          deckId: row.id,
          locale,
          name: localized.name,
          description: localized.description ?? "",
        },
        update: {
          name: localized.name,
          description: localized.description ?? "",
        },
      });
    }

    let sortOrder = 1;
    const memberCardIds: string[] = [];
    for (const memberKey of deck.memberEntityKeys) {
      const learningCardId = activeCardIdByEntityKey.get(memberKey);
      if (learningCardId === undefined) {
        continue;
      }
      memberCardIds.push(learningCardId);
      await tx.deckCard.upsert({
        where: { deckId_learningCardId: { deckId: row.id, learningCardId } },
        create: {
          deckId: row.id,
          learningCardId,
          sortOrder,
          membershipVersion: 1,
        },
        update: { sortOrder, membershipVersion: 1 },
      });
      sortOrder += 1;
    }
    await tx.deckCard.deleteMany({
      where: { deckId: row.id, learningCardId: { notIn: memberCardIds } },
    });
  }
  return deckIdByKey;
}

async function replaceFacts(
  tx: Prisma.TransactionClient,
  domain: BundleDomain,
  version: string,
  entityIdByKey: Map<string, string>,
  sourceIdByKey: Map<string, string>,
): Promise<number> {
  // Facts have no natural unique key, so a plain insert would duplicate them on
  // every publish. Replace this version's rows outright and retire the rest so
  // the read path (which filters on PUBLISHED) serves exactly one generation.
  await tx.fact.deleteMany({ where: { contentVersion: version } });
  await tx.fact.updateMany({
    where: { status: PublicationStatus.PUBLISHED },
    data: { status: PublicationStatus.RETIRED },
  });

  let inserted = 0;
  for (const collection of domain.facts) {
    for (const record of collection.records) {
      if (record.gap || record.provenance === undefined) {
        continue;
      }
      const geoEntityId = entityIdByKey.get(record.entityKey);
      if (geoEntityId === undefined) {
        continue;
      }
      const sourceId =
        sourceIdByKey.get(record.provenance.sourceKey) ??
        mapper.sourceIdForKey(record.provenance.sourceKey);
      await tx.fact.create({
        data: {
          geoEntityId,
          factType: mapper.mapFactType(collection.factType),
          value: record.value as Prisma.InputJsonValue,
          sourceId,
          status: PublicationStatus.PUBLISHED,
          contentVersion: version,
        },
      });
      inserted += 1;
    }
  }
  return inserted;
}

async function resolveRetiredResourceId(
  tx: Prisma.TransactionClient,
  resourceType: ContentResourceType,
  key: string,
): Promise<string | undefined> {
  if (resourceType === ContentResourceType.ENTITY) {
    return (
      await tx.geoEntity.findUnique({
        where: { contentKey: key },
        select: { id: true },
      })
    )?.id;
  }
  if (resourceType === ContentResourceType.ASSET) {
    return (
      await tx.asset.findUnique({
        where: { objectKey: key },
        select: { id: true },
      })
    )?.id;
  }
  if (resourceType === ContentResourceType.DECK) {
    // A change set names a deck by its content key; the row is found by the
    // code that key derives.
    return (
      await tx.deck.findUnique({
        where: { code: mapper.deckCodeFromKey(key) },
        select: { id: true },
      })
    )?.id;
  }
  if (resourceType === ContentResourceType.LEARNING_CARD) {
    const [entityKey, templateCode, semanticVersionText] = key.split(":");
    if (
      entityKey === undefined ||
      templateCode === undefined ||
      semanticVersionText === undefined
    ) {
      return undefined;
    }
    return (
      await tx.learningCard.findFirst({
        where: {
          subject: { contentKey: entityKey },
          template: { code: templateCode },
          semanticVersion: Number(semanticVersionText),
        },
        select: { id: true },
      })
    )?.id;
  }
  return undefined;
}

async function recordContentChanges(
  tx: Prisma.TransactionClient,
  version: string,
  diff: BundleDiff,
  resolved: ResolvedIds,
): Promise<number> {
  const idMapByResourceType: Partial<
    Record<ContentResourceType, Map<string, string>>
  > = {
    [ContentResourceType.ENTITY]: resolved.entityIdByKey,
    [ContentResourceType.ASSET]: resolved.assetIdByKey,
    [ContentResourceType.DECK]: resolved.deckIdByKey,
    [ContentResourceType.LEARNING_CARD]: resolved.learningCardIdByKey,
  };

  let changeCount = 0;
  for (const change of diff.resourceChanges) {
    const idMap = idMapByResourceType[change.resourceType];
    for (const key of change.upsertedKeys) {
      const resourceId = idMap?.get(key);
      if (resourceId === undefined) {
        continue;
      }
      await tx.contentChange.create({
        data: {
          contentVersion: version,
          operation: ContentChangeOperation.UPSERT,
          resourceType: change.resourceType,
          resourceId,
        },
      });
      changeCount += 1;
    }
    for (const key of change.retiredKeys) {
      const resourceId = await resolveRetiredResourceId(
        tx,
        change.resourceType,
        key,
      );
      if (resourceId === undefined) {
        continue;
      }
      await tx.contentChange.create({
        data: {
          contentVersion: version,
          operation: ContentChangeOperation.RETIRE,
          resourceType: change.resourceType,
          resourceId,
        },
      });
      changeCount += 1;
    }
  }
  return changeCount;
}

async function retireDroppedResources(
  tx: Prisma.TransactionClient,
  diff: BundleDiff,
): Promise<void> {
  for (const change of diff.resourceChanges) {
    if (change.retiredKeys.length === 0) {
      continue;
    }
    if (change.resourceType === ContentResourceType.ENTITY) {
      await tx.geoEntity.updateMany({
        where: { contentKey: { in: change.retiredKeys } },
        data: { status: GeoEntityStatus.HIDDEN },
      });
    } else if (change.resourceType === ContentResourceType.ASSET) {
      await tx.asset.updateMany({
        where: { objectKey: { in: change.retiredKeys } },
        data: { status: AssetStatus.RETIRED },
      });
    } else if (change.resourceType === ContentResourceType.DECK) {
      await tx.deck.updateMany({
        where: { code: { in: change.retiredKeys.map(mapper.deckCodeFromKey) } },
        data: { status: DeckStatus.RETIRED },
      });
    } else if (change.resourceType === ContentResourceType.LEARNING_CARD) {
      for (const key of change.retiredKeys) {
        const learningCardId = await resolveRetiredResourceId(
          tx,
          ContentResourceType.LEARNING_CARD,
          key,
        );
        if (learningCardId === undefined) {
          continue;
        }
        await tx.learningCard.update({
          where: { id: learningCardId },
          data: { status: CardStatus.RETIRED },
        });
        await tx.deckCard.deleteMany({ where: { learningCardId } });
      }
    }
  }
}

export interface BundleApplication {
  resolved: ResolvedIds;
  factCount: number;
  changeCount: number;
  diff: BundleDiff;
}

/**
 * Applies a validated bundle's domain rows inside an open transaction: diff
 * against the currently active version, upsert everything the bundle carries,
 * retire what the active version had and the bundle dropped, and record the
 * change feed. The caller owns the ContentRelease/ContentPointer/audit rows.
 * The diff runs on the same transaction client, so under Serializable
 * isolation it cannot race a concurrent publish or rollback.
 */
export async function applyBundleToDatabase(
  tx: Prisma.TransactionClient,
  bundle: LoadedBundle,
  domain: BundleDomain,
  /**
   * Where this environment serves the release's assets from, rather than where
   * the bundle was built expecting to be served: a release published into dev
   * records dev's addresses and one published into production records the
   * CDN's, because that is where each just put the files. Defaults to the
   * bundle's own statement, which is what a caller with no storage to speak
   * for has to fall back on.
   */
  servedAssetBaseUrl: string = bundle.manifest.assetBaseUrl,
): Promise<BundleApplication> {
  const version = bundle.manifest.contentVersion;
  const diff = await diffBundleAgainstActive(tx, domain);

  const sourceIdByKey = await upsertSources(tx, domain);
  const catalogSourceId = sourceIdByKey.get("catalog");
  if (catalogSourceId === undefined) {
    throw new Error("Failed to resolve the catalog source id");
  }

  const entityIdByKey = await upsertEntities(
    tx,
    domain,
    version,
    catalogSourceId,
  );
  await upsertRelations(tx, domain, entityIdByKey);
  const assetIdByKey = await upsertAssets(
    tx,
    domain,
    version,
    entityIdByKey,
    sourceIdByKey,
    servedAssetBaseUrl,
  );
  const templateIdByKey = await upsertCardTemplates(tx, domain);
  const { learningCardIdByKey, activeCardIdByEntityKey } =
    await upsertLearningCards(
      tx,
      domain,
      version,
      entityIdByKey,
      templateIdByKey,
      assetIdByKey,
    );
  const deckIdByKey = await upsertDecks(
    tx,
    domain,
    version,
    activeCardIdByEntityKey,
  );
  const factCount = await replaceFacts(
    tx,
    domain,
    version,
    entityIdByKey,
    sourceIdByKey,
  );

  await retireDroppedResources(tx, diff);

  const resolved: ResolvedIds = {
    entityIdByKey,
    assetIdByKey,
    templateIdByKey,
    learningCardIdByKey,
    activeCardIdByEntityKey,
    deckIdByKey,
  };
  const changeCount = await recordContentChanges(tx, version, diff, resolved);

  return { resolved, factCount, changeCount, diff };
}

export async function publishBundle(
  bundleDir: string,
  publicKeysByKeyId: Record<string, string>,
  prisma: PrismaClient,
  objectStorage: ObjectStorage,
): Promise<PublishSummary> {
  const { bundle, domain } = await validateBundle(bundleDir, publicKeysByKeyId);
  const version = bundle.manifest.contentVersion;
  if (domain.catalog.catalogVersion !== version) {
    throw new Error(
      `catalog.json catalogVersion (${domain.catalog.catalogVersion}) does not match manifest contentVersion (${version})`,
    );
  }

  const existingRelease = await prisma.contentRelease.findUnique({
    where: { version },
  });
  if (existingRelease?.status === ContentReleaseStatus.PUBLISHED) {
    const activePointer = await prisma.contentPointer.findUnique({
      where: { key: "active" },
    });
    if (activePointer?.contentVersion === version) {
      return {
        version,
        previousActiveVersion: version,
        alreadyPublished: true,
        counts: {
          entities: 0,
          assets: 0,
          decks: 0,
          cardTemplates: 0,
          learningCards: 0,
          facts: 0,
          changes: 0,
        },
      };
    }
  }

  await uploadBundleFiles(bundle, objectStorage);
  // Before the transaction, like the documents above: rows that named files
  // this environment does not hold are the whole of the problem.
  await uploadBundleAssets(bundle, domain, objectStorage);

  const manifestChecksum = createHash("sha256")
    .update(JSON.stringify(bundle.manifest))
    .digest("hex");
  const releaseMetadata = {
    manifest: bundle.manifest,
  } as unknown as Prisma.InputJsonObject;

  return prisma.$transaction(
    async (tx) => {
      const previousPointer = await tx.contentPointer.findUnique({
        where: { key: "active" },
      });
      const previousActiveVersion = previousPointer?.contentVersion ?? null;

      await tx.contentRelease.upsert({
        where: { version },
        create: {
          version,
          schemaVersion: bundle.manifest.schemaVersion,
          status: ContentReleaseStatus.DRAFT,
          manifestChecksum,
          metadata: releaseMetadata,
        },
        update: {
          schemaVersion: bundle.manifest.schemaVersion,
          manifestChecksum,
          metadata: releaseMetadata,
        },
      });

      const application = await applyBundleToDatabase(
        tx,
        bundle,
        domain,
        assetBaseUrl(objectStorage, version),
      );

      await tx.contentRelease.update({
        where: { version },
        data: {
          status: ContentReleaseStatus.PUBLISHED,
          publishedAt: new Date(),
        },
      });
      if (previousActiveVersion !== null && previousActiveVersion !== version) {
        await tx.contentRelease.update({
          where: { version: previousActiveVersion },
          data: { status: ContentReleaseStatus.RETIRED, retiredAt: new Date() },
        });
      }
      await tx.contentPointer.upsert({
        where: { key: "active" },
        create: { key: "active", contentVersion: version },
        update: { contentVersion: version },
      });

      await tx.auditEvent.create({
        data: {
          action: "content.publish",
          targetType: "content_release",
          targetId: version,
          metadata: {
            previousActiveVersion,
            changeCount: application.changeCount,
          },
        },
      });

      return {
        version,
        previousActiveVersion,
        alreadyPublished: false,
        counts: {
          entities: application.resolved.entityIdByKey.size,
          assets: application.resolved.assetIdByKey.size,
          decks: application.resolved.deckIdByKey.size,
          cardTemplates: application.resolved.templateIdByKey.size,
          learningCards: application.resolved.learningCardIdByKey.size,
          facts: application.factCount,
          changes: application.changeCount,
        },
      } satisfies PublishSummary;
    },
    { isolationLevel: "Serializable", maxWait: 30_000, timeout: 300_000 },
  );
}
