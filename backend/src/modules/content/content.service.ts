import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AssetStatus,
  CardStatus,
  ContentReleaseStatus,
  DeckStatus,
  GeoEntityStatus,
  GeoNameType,
  PublicationStatus,
  RecognitionStatus,
} from "@prisma/client";

import { validationError } from "../../common/http/request-validation";
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
      validationError(
        "after",
        "is required; the manifest carries the first one",
      );
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
    // The order a person reads is decided here, by the name they are shown,
    // not by the editorial key the membership was published under. Sorted by
    // key, "All countries" opened on Bouvet Island and Cook Islands, because
    // `area.*` sorts before `country.*` (#267).
    //
    // Resolved per request rather than at publication: one release is read in
    // every locale, and each has its own alphabet.
    const ordered = await this.orderedDeckCardIds(
      deckId,
      localeCandidates(locale, manifest.defaultLocale),
      cursor,
      limit,
    );
    const memberships = await this.prisma.deckCard.findMany({
      where: {
        deckId,
        learningCardId: {
          in: ordered.map(({ learningCardId }) => learningCardId),
        },
      },
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
    // The page's order is the ordering query's; this second read only
    // fetches the rows and returns them however the database found them.
    const byCard = new Map(
      memberships.map((membership) => [membership.learningCardId, membership]),
    );
    const hasMore = ordered.length > limit;
    const pageItems = (hasMore ? ordered.slice(0, limit) : ordered).flatMap(
      (entry) => {
        const membership = byCard.get(entry.learningCardId);
        return membership === undefined ? [] : [membership];
      },
    );
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
    const lastOrdered = (hasMore ? ordered.slice(0, limit) : ordered).at(-1);

    return {
      items,
      page: {
        nextCursor:
          hasMore && lastOrdered !== undefined
            ? encodeCardCursor(lastOrdered.sortName, lastOrdered.learningCardId)
            : null,
        hasMore,
      },
    };
  }

  /**
   * One deck's cards in the reader's alphabet, one page at a time.
   *
   * Raw SQL because the order is a property of a related row — the entity's
   * name in the requested locale — which the query builder cannot sort by.
   * The name is chosen the way every other read chooses it: the first locale
   * candidate that has one, falling back through the language and the
   * release's default.
   *
   * `sort_name` is the name lowercased. It is not a linguistically correct
   * collation for every alphabet, and does not pretend to be: it puts the
   * list in the order a reader expects to scan, which sorting by an internal
   * key never did. The client sorts what it holds with the platform's own
   * collator on top of this.
   *
   * The card id breaks ties as text on both sides of the comparison, so the
   * page boundary and the order agree whatever collation the database was
   * created with.
   */
  private async orderedDeckCardIds(
    deckId: string,
    candidates: string[],
    cursor: { sortName: string; learningCardId: string } | undefined,
    limit: number,
  ): Promise<{ learningCardId: string; sortName: string }[]> {
    const rows = await this.prisma.$queryRaw<
      { learningCardId: string; sortName: string }[]
    >`
      SELECT dc.learning_card_id AS "learningCardId",
             COALESCE(lower(named.value), '') AS "sortName"
        FROM deck_cards dc
        JOIN learning_cards lc
          ON lc.id = dc.learning_card_id
         AND lc.status = 'ACTIVE'::"CardStatus"
        LEFT JOIN LATERAL (
               SELECT n.value
                 FROM geo_entity_names n
                WHERE n.geo_entity_id = lc.subject_entity_id
                  AND n.name_type = 'SHORT'::"GeoNameType"
                  AND lower(n.locale) = ANY(${candidates}::text[])
                ORDER BY array_position(${candidates}::text[], lower(n.locale)),
                         n.is_primary DESC,
                         n.value
                LIMIT 1
             ) AS named ON TRUE
       WHERE dc.deck_id = ${deckId}::uuid
         AND (
               ${cursor === undefined}::boolean
               OR (COALESCE(lower(named.value), ''), dc.learning_card_id::text)
                  > (${cursor?.sortName ?? ""}, ${cursor?.learningCardId ?? ""})
             )
       ORDER BY "sortName", dc.learning_card_id::text
       LIMIT ${limit + 1}
    `;
    return rows;
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
