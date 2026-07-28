import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AssetStatus,
  CardStatus,
  DeckStatus,
  PublicationStatus,
  type Prisma,
} from "@prisma/client";

import { PrismaService } from "../../infrastructure/database/prisma.service";
import {
  decodeCardCursor,
  decodeDeckCursor,
  encodeCardCursor,
  encodeDeckCursor,
} from "./content-cursor";
import { localeCandidates } from "./content-query";

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
    const items = pageItems.map((deck) => {
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
    });
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
        backSideFacts: learningCard.subject.facts.map((fact) => ({
          type: fact.factType,
          displayValue: this.factDisplayValue(fact.value),
          observedAt:
            fact.observedAt === null
              ? null
              : fact.observedAt.toISOString().slice(0, 10),
          source: {
            name: fact.source.name,
            url: fact.source.url,
          },
        })),
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

  private mapAsset(asset: {
    id: string;
    assetType: string;
    publicUrl: string;
    mimeType: string;
    sha256: string;
    width: number | null;
    height: number | null;
    aspectRatio: Prisma.Decimal | null;
    licenseName: string;
    attribution: string | null;
    status: AssetStatus;
  }): Record<string, unknown> {
    if (asset.status !== AssetStatus.PUBLISHED) {
      throw new Error(`Asset ${asset.id} is not published`);
    }

    return {
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
    };
  }

  private factDisplayValue(value: Prisma.JsonValue): string {
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
}
