import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AssetStatus,
  CardStatus,
  ContentReleaseStatus,
  DeckStatus,
  GeoEntityStatus,
  GeoNameType,
  PublicationStatus,
  RecognitionStatus,
  type Prisma,
} from "@prisma/client";

import { PrismaService } from "../../infrastructure/database/prisma.service";
import {
  ASSET_REPRESENTATIONS_INCLUDE,
  mapAssetRepresentations,
  type AssetWithRepresentations,
} from "./asset-representations";
import {
  decodeCardCursor,
  decodeContentChangeCursor,
  decodeDeckCursor,
  encodeCardCursor,
  encodeContentChangeCursor,
  encodeDeckCursor,
} from "./content-cursor";
import { localeCandidates } from "./content-query";
import { mapBackSideFacts } from "./fact-display";

interface StoredManifest {
  defaultLocale: string;
  [key: string]: unknown;
}

interface LocalizedValue {
  locale: string;
  name: string;
  description: string;
}

interface EntityName {
  locale: string;
  value: string;
  isPrimary: boolean;
}

// Detail routes never serve entities the catalog hides; a hidden entity is
// delivered to clients as a RETIRE content change instead.
const READABLE_ENTITY_STATUSES = [
  GeoEntityStatus.ACTIVE,
  GeoEntityStatus.HISTORICAL,
];

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  async getManifest(): Promise<{
    manifest: StoredManifest;
    checksum: string;
  }> {
    const pointer = await this.prisma.contentPointer.findUnique({
      where: { key: "active" },
      include: { release: true },
    });
    if (pointer === null) {
      throw new NotFoundException("Active content manifest was not found");
    }

    const metadata = pointer.release.metadata;
    if (
      typeof metadata !== "object" ||
      metadata === null ||
      Array.isArray(metadata) ||
      !("manifest" in metadata)
    ) {
      throw new Error("Active content release has no manifest metadata");
    }

    const manifest = metadata.manifest;
    if (
      typeof manifest !== "object" ||
      manifest === null ||
      Array.isArray(manifest) ||
      !("defaultLocale" in manifest) ||
      typeof manifest.defaultLocale !== "string"
    ) {
      throw new Error("Active content release manifest is invalid");
    }

    return {
      manifest: manifest as StoredManifest,
      checksum: pointer.release.manifestChecksum,
    };
  }

  async listDecks(
    locale: string,
    cursorValue: string | undefined,
    limit: number,
  ): Promise<{
    items: Array<Record<string, unknown>>;
    page: { nextCursor: string | null; hasMore: boolean };
  }> {
    const { manifest } = await this.getManifest();
    const cursor =
      cursorValue === undefined ? undefined : decodeDeckCursor(cursorValue);
    const decks = await this.prisma.deck.findMany({
      where: {
        status: DeckStatus.PUBLISHED,
        ...(cursor === undefined ? {} : { code: { gt: cursor.code } }),
      },
      orderBy: [{ code: "asc" }, { id: "asc" }],
      take: limit + 1,
      include: {
        localizations: true,
        _count: {
          select: {
            cards: {
              where: {
                learningCard: { status: CardStatus.ACTIVE },
              },
            },
          },
        },
      },
    });
    const hasMore = decks.length > limit;
    const pageItems = hasMore ? decks.slice(0, limit) : decks;
    const candidates = localeCandidates(locale, manifest.defaultLocale);
    const items = pageItems.map((deck) => this.mapDeck(deck, candidates));
    const lastDeck = pageItems.at(-1);

    return {
      items,
      page: {
        nextCursor:
          hasMore && lastDeck !== undefined
            ? encodeDeckCursor(lastDeck.code)
            : null,
        hasMore,
      },
    };
  }

  async getDeck(
    deckId: string,
    locale: string,
  ): Promise<Record<string, unknown>> {
    const [{ manifest }, deck] = await Promise.all([
      this.getManifest(),
      this.prisma.deck.findFirst({
        where: { id: deckId, status: DeckStatus.PUBLISHED },
        include: {
          localizations: true,
          _count: {
            select: {
              cards: {
                where: {
                  learningCard: { status: CardStatus.ACTIVE },
                },
              },
            },
          },
        },
      }),
    ]);
    if (deck === null) {
      throw new NotFoundException("Deck was not found");
    }

    return this.mapDeck(deck, localeCandidates(locale, manifest.defaultLocale));
  }

  async getEntity(
    entityId: string,
    locale: string,
  ): Promise<Record<string, unknown>> {
    const [{ manifest }, entity] = await Promise.all([
      this.getManifest(),
      this.prisma.geoEntity.findFirst({
        where: { id: entityId, status: { in: READABLE_ENTITY_STATUSES } },
        include: {
          names: true,
          assets: {
            where: { status: AssetStatus.PUBLISHED },
            orderBy: [{ assetType: "asc" }, { id: "asc" }],
            include: ASSET_REPRESENTATIONS_INCLUDE,
          },
          facts: {
            where: { status: PublicationStatus.PUBLISHED },
            include: { source: true },
            orderBy: [{ factType: "asc" }, { id: "asc" }],
          },
        },
      }),
    ]);
    if (entity === null) {
      throw new NotFoundException("Entity was not found");
    }

    const candidates = localeCandidates(locale, manifest.defaultLocale);
    const short = this.selectEntityName(entity.names, candidates);
    const official = this.selectLocalizedNameValue(
      entity.names,
      candidates,
      GeoNameType.OFFICIAL,
    );
    const aliases = entity.names
      .filter(
        (name) =>
          candidates.includes(name.locale.toLowerCase()) &&
          name.value !== short.value &&
          name.value !== official,
      )
      .map(({ value }) => value)
      .filter((value, index, values) => values.indexOf(value) === index);

    return {
      id: entity.id,
      kind: entity.kind,
      status: entity.status,
      // The contract keeps recognitionStatus required; an unclassified entity
      // is explicitly NOT_APPLICABLE instead of an absent field.
      recognitionStatus:
        entity.recognitionStatus ?? RecognitionStatus.NOT_APPLICABLE,
      name: {
        short: short.value,
        official: official ?? null,
        aliases,
      },
      assets: entity.assets.map((asset) => this.mapAsset(asset)),
      facts: mapBackSideFacts(entity.facts, locale),
      contentVersion: entity.contentVersion,
    };
  }

  async listChanges(
    after: string | undefined,
    limit: number,
  ): Promise<{
    items: Array<Record<string, unknown>>;
    nextCursor: string;
    hasMore: boolean;
    contentVersion: string;
  }> {
    if (after === undefined) {
      throw new BadRequestException("after cursor is required");
    }
    const cursor = decodeContentChangeCursor(after);
    const [pointer, changes] = await this.prisma.$transaction(
      async (transaction) =>
        Promise.all([
          transaction.contentPointer.findUnique({
            where: { key: "active" },
            select: { contentVersion: true },
          }),
          transaction.contentChange.findMany({
            where: {
              sequence: { gt: cursor.sequence },
              release: {
                status: {
                  in: [
                    ContentReleaseStatus.PUBLISHED,
                    ContentReleaseStatus.RETIRED,
                  ],
                },
                publishedAt: { not: null },
              },
            },
            orderBy: { sequence: "asc" },
            take: limit + 1,
            select: {
              sequence: true,
              operation: true,
              resourceType: true,
              resourceId: true,
              contentVersion: true,
            },
          }),
        ]),
      { isolationLevel: "RepeatableRead" },
    );
    if (pointer === null) {
      throw new NotFoundException("Active content manifest was not found");
    }

    const hasMore = changes.length > limit;
    const pageItems = hasMore ? changes.slice(0, limit) : changes;
    const nextSequence = pageItems.at(-1)?.sequence ?? cursor.sequence;

    return {
      items: pageItems.map((change) => ({
        operation: change.operation,
        resourceType: change.resourceType,
        resourceId: change.resourceId,
        contentVersion: change.contentVersion,
      })),
      nextCursor: encodeContentChangeCursor(
        pointer.contentVersion,
        nextSequence,
      ),
      hasMore,
      contentVersion: pointer.contentVersion,
    };
  }

  async listDeckCards(
    deckId: string,
    locale: string,
    cursorValue: string | undefined,
    limit: number,
  ): Promise<{
    items: Array<Record<string, unknown>>;
    page: { nextCursor: string | null; hasMore: boolean };
  }> {
    const [{ manifest }, deck] = await Promise.all([
      this.getManifest(),
      this.prisma.deck.findFirst({
        where: { id: deckId, status: DeckStatus.PUBLISHED },
        select: { id: true },
      }),
    ]);
    if (deck === null) {
      throw new NotFoundException("Deck was not found");
    }

    const cursor =
      cursorValue === undefined ? undefined : decodeCardCursor(cursorValue);
    const cursorWhere: Prisma.DeckCardWhereInput =
      cursor === undefined
        ? {}
        : cursor.sortOrder === null
          ? {
              sortOrder: null,
              learningCardId: { gt: cursor.learningCardId },
            }
          : {
              OR: [
                { sortOrder: { gt: cursor.sortOrder } },
                { sortOrder: null },
                {
                  sortOrder: cursor.sortOrder,
                  learningCardId: { gt: cursor.learningCardId },
                },
              ],
            };
    const memberships = await this.prisma.deckCard.findMany({
      where: {
        deckId,
        learningCard: { status: CardStatus.ACTIVE },
        ...cursorWhere,
      },
      orderBy: [
        { sortOrder: { sort: "asc", nulls: "last" } },
        { learningCardId: "asc" },
      ],
      take: limit + 1,
      include: {
        learningCard: {
          include: {
            template: true,
            revisions: {
              where: { retiredAt: null },
              orderBy: { revision: "desc" },
              take: 1,
              include: {
                promptAsset: { include: ASSET_REPRESENTATIONS_INCLUDE },
              },
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
          },
        },
      },
    });
    const hasMore = memberships.length > limit;
    const pageItems = hasMore ? memberships.slice(0, limit) : memberships;
    const candidates = localeCandidates(locale, manifest.defaultLocale);
    const items = pageItems.map(({ learningCard }) => {
      const revision = learningCard.revisions[0];
      if (revision?.promptAsset === null || revision === undefined) {
        throw new Error(`Learning card ${learningCard.id} has no active asset`);
      }

      const entityName = this.selectEntityName(
        learningCard.subject.names,
        candidates,
      );
      const aliases = learningCard.subject.names
        .filter(
          (name) =>
            candidates.includes(name.locale.toLowerCase()) &&
            name.value !== entityName.value,
        )
        .map(({ value }) => value)
        .filter((value, index, values) => values.indexOf(value) === index);

      return {
        id: learningCard.id,
        templateCode: learningCard.template.code,
        templateSchemaVersion: learningCard.template.schemaVersion,
        semanticVersion: learningCard.semanticVersion,
        revision: revision.revision,
        answerMode: learningCard.template.gradingMode,
        prompt: {
          asset: this.mapAsset(revision.promptAsset),
        },
        answer: {
          entityId: learningCard.subject.id,
          displayName: entityName.value,
          aliases,
        },
        backSideFacts: mapBackSideFacts(learningCard.subject.facts, locale),
        contentVersion: learningCard.contentVersion,
      };
    });
    const lastMembership = pageItems.at(-1);

    return {
      items,
      page: {
        nextCursor:
          hasMore && lastMembership !== undefined
            ? encodeCardCursor(
                lastMembership.sortOrder,
                lastMembership.learningCardId,
              )
            : null,
        hasMore,
      },
    };
  }

  private mapDeck(
    deck: {
      id: string;
      code: string;
      kind: string;
      contentVersion: string;
      localizations: LocalizedValue[];
      _count: { cards: number };
    },
    candidates: string[],
  ): Record<string, unknown> {
    const localization = this.selectLocalization(
      deck.localizations,
      candidates,
    );
    return {
      id: deck.id,
      code: deck.code,
      kind: deck.kind,
      name: localization.name,
      description: localization.description,
      cardCount: deck._count.cards,
      contentVersion: deck.contentVersion,
    };
  }

  private selectLocalizedNameValue(
    values: Array<EntityName & { nameType: GeoNameType }>,
    candidates: string[],
    nameType: GeoNameType,
  ): string | null {
    for (const candidate of candidates) {
      const name = values.find(
        (value) =>
          value.nameType === nameType &&
          value.locale.toLowerCase() === candidate,
      );
      if (name !== undefined) {
        return name.value;
      }
    }

    return null;
  }

  private selectLocalization(
    values: LocalizedValue[],
    candidates: string[],
  ): LocalizedValue {
    for (const candidate of candidates) {
      const localization = values.find(
        ({ locale }) => locale.toLowerCase() === candidate,
      );
      if (localization !== undefined) {
        return localization;
      }
    }
    throw new Error("Published deck has no fallback localization");
  }

  private selectEntityName(
    values: EntityName[],
    candidates: string[],
  ): EntityName {
    for (const candidate of candidates) {
      const name = values.find(
        ({ locale, isPrimary }) =>
          isPrimary && locale.toLowerCase() === candidate,
      );
      if (name !== undefined) {
        return name;
      }
    }
    throw new Error("Published entity has no fallback localized name");
  }

  private mapAsset(asset: AssetWithRepresentations): Record<string, unknown> {
    if (asset.status !== AssetStatus.PUBLISHED) {
      throw new Error(`Asset ${asset.id} is not published`);
    }

    return {
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
    };
  }
}
