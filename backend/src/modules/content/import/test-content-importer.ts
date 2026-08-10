import {
  CardStatus,
  ContentReleaseStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { TEST_CONTENT_FIXTURE } from "../fixtures/test-content.fixture";

export interface ContentImportSummary {
  version: string;
  marker: "TEST_ONLY";
  entities: number;
  assets: number;
  cards: number;
  decks: number;
}

function validateFixture(): void {
  if (TEST_CONTENT_FIXTURE.marker !== "TEST_ONLY") {
    throw new Error("The development content fixture must be marked TEST_ONLY");
  }

  const countries = TEST_CONTENT_FIXTURE.entities.filter(
    ({ includeInCountryCatalog }) => includeInCountryCatalog,
  );
  if (countries.length < 8) {
    throw new Error("The development content fixture requires 8 countries");
  }

  for (const source of TEST_CONTENT_FIXTURE.sources) {
    if (
      source.url.length === 0 ||
      source.licenseName.length === 0 ||
      source.licenseUrl.length === 0
    ) {
      throw new Error(`Source ${source.id} has incomplete license metadata`);
    }
  }

  for (const asset of TEST_CONTENT_FIXTURE.assets) {
    if (
      asset.licenseName.length === 0 ||
      asset.licenseUrl.length === 0 ||
      !/^https:\/\//u.test(asset.publicUrl)
    ) {
      throw new Error(`Asset ${asset.id} has invalid source/license metadata`);
    }
  }

  const localeKeys = new Set(
    TEST_CONTENT_FIXTURE.names.map(
      ({ geoEntityId, locale }) => `${geoEntityId}:${locale}`,
    ),
  );
  for (const entity of TEST_CONTENT_FIXTURE.entities) {
    for (const locale of TEST_CONTENT_FIXTURE.manifest.supportedLocales) {
      if (!localeKeys.has(`${entity.id}:${locale}`)) {
        throw new Error(`Entity ${entity.contentKey} has no ${locale} name`);
      }
    }
  }
}

async function importTransaction(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  const fixture = TEST_CONTENT_FIXTURE;
  const timestamp = new Date(fixture.createdAt);

  await transaction.contentRelease.upsert({
    where: { version: fixture.version },
    create: {
      version: fixture.version,
      schemaVersion: fixture.manifest.schemaVersion,
      status: ContentReleaseStatus.DRAFT,
      manifestChecksum: fixture.manifestChecksum,
      metadata: {
        marker: fixture.marker,
        manifest: fixture.manifest,
      },
      createdAt: timestamp,
    },
    update: {
      schemaVersion: fixture.manifest.schemaVersion,
      status: ContentReleaseStatus.DRAFT,
      manifestChecksum: fixture.manifestChecksum,
      metadata: {
        marker: fixture.marker,
        manifest: fixture.manifest,
      },
      publishedAt: null,
      retiredAt: null,
    },
  });

  for (const source of fixture.sources) {
    const data = {
      name: source.name,
      url: source.url,
      licenseName: source.licenseName,
      licenseUrl: source.licenseUrl,
      retrievedAt: new Date(source.retrievedAt),
      metadata: source.metadata,
    };
    await transaction.source.upsert({
      where: { id: source.id },
      create: { id: source.id, ...data },
      update: data,
    });
  }

  for (const entity of fixture.entities) {
    const data = {
      contentKey: entity.contentKey,
      kind: entity.kind,
      slug: entity.slug,
      isoAlpha2: entity.isoAlpha2,
      isoAlpha3: entity.isoAlpha3,
      m49Code: entity.m49Code,
      customCode: entity.customCode,
      status: entity.status,
      includeInCountryCatalog: entity.includeInCountryCatalog,
      recognitionStatus: entity.recognitionStatus,
      metadata: entity.metadata,
      contentVersion: entity.contentVersion,
    };
    await transaction.geoEntity.upsert({
      where: { id: entity.id },
      create: { id: entity.id, ...data },
      update: data,
    });
  }

  for (const name of fixture.names) {
    const data = {
      geoEntityId: name.geoEntityId,
      locale: name.locale,
      nameType: name.nameType,
      value: name.value,
      isPrimary: name.isPrimary,
      sourceId: name.sourceId,
    };
    await transaction.geoEntityName.upsert({
      where: { id: name.id },
      create: { id: name.id, ...data },
      update: data,
    });
  }

  for (const relation of fixture.relations) {
    const data = {
      parentEntityId: relation.parentEntityId,
      childEntityId: relation.childEntityId,
      taxonomyCode: relation.taxonomyCode,
      relationType: relation.relationType,
      sortOrder: relation.sortOrder,
      metadata: relation.metadata,
    };
    await transaction.geoRelation.upsert({
      where: { id: relation.id },
      create: { id: relation.id, ...data },
      update: data,
    });
  }

  for (const asset of fixture.assets) {
    const data = {
      geoEntityId: asset.geoEntityId,
      assetType: asset.assetType,
      variant: asset.variant,
      objectKey: asset.objectKey,
      publicUrl: asset.publicUrl,
      mimeType: asset.mimeType,
      sha256: asset.sha256,
      width: asset.width,
      height: asset.height,
      aspectRatio: asset.aspectRatio,
      sourceId: asset.sourceId,
      licenseName: asset.licenseName,
      licenseUrl: asset.licenseUrl,
      attribution: asset.attribution,
      status: asset.status,
      contentVersion: asset.contentVersion,
    };
    await transaction.asset.upsert({
      where: { id: asset.id },
      create: { id: asset.id, ...data },
      update: data,
    });
    // Replaced rather than upserted so a fixture that drops a representation
    // leaves nothing of it behind.
    await transaction.assetRepresentation.deleteMany({
      where: { assetId: asset.id },
    });
    await transaction.assetRepresentation.createMany({
      data: asset.representations.map((representation, index) => ({
        assetId: asset.id,
        sortOrder: index,
        ...representation,
      })),
    });
  }

  const template = fixture.template;
  const templateData = {
    code: template.code,
    schemaVersion: template.schemaVersion,
    promptType: template.promptType,
    answerType: template.answerType,
    gradingMode: template.gradingMode,
    promptSpec: template.promptSpec,
    answerSpec: template.answerSpec,
    backSideFactTypes: [...template.backSideFactTypes],
    status: template.status,
  };
  await transaction.cardTemplate.upsert({
    where: { id: template.id },
    create: { id: template.id, ...templateData },
    update: templateData,
  });

  const orderedCards = [...fixture.learningCards].sort(
    (left, right) =>
      Number(left.status === CardStatus.ACTIVE) -
      Number(right.status === CardStatus.ACTIVE),
  );
  for (const card of orderedCards) {
    const data = {
      subjectEntityId: card.subjectEntityId,
      templateId: card.templateId,
      semanticVersion: card.semanticVersion,
      supersedesLearningCardId: card.supersedesLearningCardId,
      status: card.status,
      contentVersion: card.contentVersion,
    };
    await transaction.learningCard.upsert({
      where: { id: card.id },
      create: { id: card.id, ...data },
      update: data,
    });
  }

  for (const revision of fixture.revisions) {
    const data = {
      learningCardId: revision.learningCardId,
      revision: revision.revision,
      promptAssetId: revision.promptAssetId,
      promptFingerprint: revision.promptFingerprint,
      changeClassification: revision.changeClassification,
      progressPolicy: revision.progressPolicy,
      contentVersion: revision.contentVersion,
      effectiveFrom: new Date(revision.effectiveFrom),
      retiredAt:
        revision.retiredAt === null ? null : new Date(revision.retiredAt),
    };
    await transaction.learningCardRevision.upsert({
      where: { id: revision.id },
      create: { id: revision.id, ...data },
      update: data,
    });
  }

  const countryByKey = new Map(
    fixture.entities.map((entity) => [entity.contentKey, entity]),
  );
  const activeCardByEntity = new Map(
    fixture.learningCards
      .filter(({ status }) => status === CardStatus.ACTIVE)
      .map((card) => [card.subjectEntityId, card]),
  );

  for (const deck of fixture.decks) {
    const deckData = {
      code: deck.code,
      kind: deck.kind,
      ruleSpec: deck.ruleSpec,
      status: deck.status,
      contentVersion: deck.contentVersion,
    };
    await transaction.deck.upsert({
      where: { id: deck.id },
      create: { id: deck.id, ...deckData },
      update: deckData,
    });

    for (const localization of deck.localizations) {
      await transaction.deckLocalization.upsert({
        where: {
          deckId_locale: {
            deckId: deck.id,
            locale: localization.locale,
          },
        },
        create: { deckId: deck.id, ...localization },
        update: {
          name: localization.name,
          description: localization.description,
        },
      });
    }

    for (const [index, countryKey] of deck.countryKeys.entries()) {
      const entity = countryByKey.get(countryKey);
      const card =
        entity === undefined ? undefined : activeCardByEntity.get(entity.id);
      if (entity === undefined || card === undefined) {
        throw new Error(
          `Deck ${deck.code} references ${countryKey} without a card`,
        );
      }

      await transaction.deckCard.upsert({
        where: {
          deckId_learningCardId: {
            deckId: deck.id,
            learningCardId: card.id,
          },
        },
        create: {
          deckId: deck.id,
          learningCardId: card.id,
          sortOrder: index + 1,
          membershipVersion: 1,
        },
        update: {
          sortOrder: index + 1,
          membershipVersion: 1,
        },
      });
    }
  }

  await transaction.contentRelease.update({
    where: { version: fixture.version },
    data: {
      status: fixture.releaseStatus,
      publishedAt: timestamp,
    },
  });
  await transaction.contentPointer.upsert({
    where: { key: "active" },
    create: {
      key: "active",
      contentVersion: fixture.version,
    },
    update: {
      contentVersion: fixture.version,
    },
  });
}

export async function importTestContent(
  prisma: PrismaClient,
): Promise<ContentImportSummary> {
  validateFixture();
  await prisma.$transaction(importTransaction, {
    isolationLevel: "Serializable",
    maxWait: 10_000,
    timeout: 30_000,
  });

  return {
    version: TEST_CONTENT_FIXTURE.version,
    marker: TEST_CONTENT_FIXTURE.marker,
    entities: TEST_CONTENT_FIXTURE.entities.length,
    assets: TEST_CONTENT_FIXTURE.assets.length,
    cards: TEST_CONTENT_FIXTURE.learningCards.length,
    decks: TEST_CONTENT_FIXTURE.decks.length,
  };
}
