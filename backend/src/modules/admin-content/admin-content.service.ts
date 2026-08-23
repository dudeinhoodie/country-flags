import { HttpStatus, Injectable } from "@nestjs/common";
import {
  AssetStatus,
  AssetType,
  CardStatus,
  DeckStatus,
  GeoEntityStatus,
  RecognitionStatus,
} from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import {
  ADMIN_ASSET_INCLUDE,
  mapAdminAsset,
  primaryName,
} from "./admin-content.response";

// Mirrors the public read model on purpose: the admin console must show
// exactly what clients can see (ADR-014), only with richer metadata.
const READABLE_ENTITY_STATUSES = [
  GeoEntityStatus.ACTIVE,
  GeoEntityStatus.HISTORICAL,
];

function contentNotFound(): never {
  throw new ApiException(
    HttpStatus.NOT_FOUND,
    "RESOURCE_NOT_FOUND",
    "The requested resource was not found",
  );
}

const ENTITY_INCLUDE = {
  names: true,
  assets: {
    where: { status: AssetStatus.PUBLISHED },
    orderBy: [{ assetType: "asc" }, { id: "asc" }],
    include: ADMIN_ASSET_INCLUDE,
  },
} satisfies Prisma.GeoEntityInclude;

type EntityWithRelations = Prisma.GeoEntityGetPayload<{
  include: typeof ENTITY_INCLUDE;
}>;

const DECK_INCLUDE = {
  localizations: true,
  _count: {
    select: {
      cards: { where: { learningCard: { status: CardStatus.ACTIVE } } },
    },
  },
} satisfies Prisma.DeckInclude;

type DeckWithRelations = Prisma.DeckGetPayload<{
  include: typeof DECK_INCLUDE;
}>;

@Injectable()
export class AdminContentService {
  constructor(private readonly database: PrismaService) {}

  async status(): Promise<Record<string, unknown>> {
    const [pointer, entityCount, deckCount] = await this.database.$transaction([
      this.database.contentPointer.findUnique({
        where: { key: "active" },
        include: { release: true },
      }),
      this.database.geoEntity.count({
        where: { status: { in: READABLE_ENTITY_STATUSES } },
      }),
      this.database.deck.count({
        where: { status: DeckStatus.PUBLISHED },
      }),
    ]);
    return {
      activeVersion: pointer?.contentVersion ?? null,
      schemaVersion: pointer?.release.schemaVersion ?? null,
      publishedAt: pointer?.release.publishedAt?.toISOString() ?? null,
      entityCount,
      deckCount,
    };
  }

  async listEntities(
    offset: number,
    limit: number,
    search: string | undefined,
  ): Promise<{ items: Record<string, unknown>[]; total: number }> {
    const where: Prisma.GeoEntityWhereInput = {
      status: { in: READABLE_ENTITY_STATUSES },
      ...(search === undefined ? {} : this.entitySearch(search)),
    };
    const [entities, total] = await this.database.$transaction([
      this.database.geoEntity.findMany({
        where,
        orderBy: { slug: "asc" },
        skip: offset,
        take: limit,
        include: ENTITY_INCLUDE,
      }),
      this.database.geoEntity.count({ where }),
    ]);
    return {
      items: entities.map((entity) => this.entitySummary(entity)),
      total,
    };
  }

  async getEntity(entityId: string): Promise<Record<string, unknown>> {
    const entity = await this.database.geoEntity.findFirst({
      where: { id: entityId, status: { in: READABLE_ENTITY_STATUSES } },
      include: ENTITY_INCLUDE,
    });
    if (entity === null) {
      contentNotFound();
    }
    return {
      ...this.entitySummary(entity),
      names: entity.names
        .map((name) => ({
          locale: name.locale,
          nameType: name.nameType,
          value: name.value,
          isPrimary: name.isPrimary,
        }))
        .sort(
          (left, right) =>
            left.locale.localeCompare(right.locale) ||
            left.nameType.localeCompare(right.nameType) ||
            left.value.localeCompare(right.value),
        ),
      assets: entity.assets.map(mapAdminAsset),
      includeInCountryCatalog: entity.includeInCountryCatalog,
      validFrom: entity.validFrom?.toISOString() ?? null,
      validTo: entity.validTo?.toISOString() ?? null,
    };
  }

  async listDecks(
    offset: number,
    limit: number,
  ): Promise<{ items: Record<string, unknown>[]; total: number }> {
    const where: Prisma.DeckWhereInput = { status: DeckStatus.PUBLISHED };
    const [decks, total] = await this.database.$transaction([
      this.database.deck.findMany({
        where,
        orderBy: { code: "asc" },
        skip: offset,
        take: limit,
        include: DECK_INCLUDE,
      }),
      this.database.deck.count({ where }),
    ]);
    return { items: decks.map((deck) => this.deckSummary(deck)), total };
  }

  async getDeck(deckId: string): Promise<Record<string, unknown>> {
    const deck = await this.database.deck.findFirst({
      where: { id: deckId, status: DeckStatus.PUBLISHED },
      include: DECK_INCLUDE,
    });
    if (deck === null) {
      contentNotFound();
    }
    return {
      ...this.deckSummary(deck),
      localizations: deck.localizations
        .map((localization) => ({
          locale: localization.locale,
          name: localization.name,
          description: localization.description,
        }))
        .sort((left, right) => left.locale.localeCompare(right.locale)),
      ruleSpec: deck.ruleSpec,
    };
  }

  private entitySearch(search: string): Prisma.GeoEntityWhereInput {
    return {
      OR: [
        { slug: { contains: search, mode: "insensitive" } },
        { contentKey: { contains: search, mode: "insensitive" } },
        { isoAlpha2: { equals: search, mode: "insensitive" } },
        { isoAlpha3: { equals: search, mode: "insensitive" } },
        {
          names: {
            some: { value: { contains: search, mode: "insensitive" } },
          },
        },
      ],
    };
  }

  private entitySummary(entity: EntityWithRelations): Record<string, unknown> {
    const flag = entity.assets.find(
      (asset) => asset.assetType === AssetType.FLAG,
    );
    return {
      id: entity.id,
      contentKey: entity.contentKey,
      slug: entity.slug,
      kind: entity.kind,
      status: entity.status,
      recognitionStatus:
        entity.recognitionStatus ?? RecognitionStatus.NOT_APPLICABLE,
      isoAlpha2: entity.isoAlpha2,
      isoAlpha3: entity.isoAlpha3,
      nameRu: primaryName(entity.names, "ru"),
      nameEn: primaryName(entity.names, "en"),
      flag: flag === undefined ? null : mapAdminAsset(flag),
      contentVersion: entity.contentVersion,
    };
  }

  private deckSummary(deck: DeckWithRelations): Record<string, unknown> {
    const byLocale = new Map(
      deck.localizations.map((localization) => [
        localization.locale.toLowerCase(),
        localization,
      ]),
    );
    return {
      id: deck.id,
      code: deck.code,
      kind: deck.kind,
      status: deck.status,
      cardCount: deck._count.cards,
      nameRu: byLocale.get("ru")?.name ?? null,
      nameEn: byLocale.get("en")?.name ?? null,
      contentVersion: deck.contentVersion,
    };
  }
}
