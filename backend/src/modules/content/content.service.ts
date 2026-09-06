import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AssetStatus,
  CardStatus,
  ContentChangeOperation,
  ContentReleaseStatus,
  ContentResourceType,
  DeckAccessModel,
  DeckStatus,
  GeoEntityStatus,
  GeoNameType,
  PublicationStatus,
  RecognitionStatus,
} from "@prisma/client";

import { validationError } from "../../common/http/request-validation";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import type { ClientCapability } from "../client-compatibility/client-compatibility.service";
import {
  type DeckAccessPolicy,
  DeckAccessService,
  type DeckAccessSubject,
} from "../commerce/deck-access.service";
import {
  ASSET_REPRESENTATIONS_INCLUDE,
  mapAssetRepresentations,
  type AssetWithRepresentations,
} from "./asset-representations";
import {
  ContentAccessProjectionService,
  type ContentVisibility,
  isPubliclyVisible,
  isVisibleToClient,
} from "./content-access-projection.service";
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

/**
 * The access models a client build that predates the paid-deck contract can
 * render. Not a second access rule: `FREE` is the only value such a build has
 * ever been sent, and a deck carrying any other one would be drawn as an
 * ordinary free deck with a study button that leads to a 403.
 *
 * A new access model is unintelligible to those builds by definition, so this
 * list stays as it is when one is added — that is the point of writing it
 * down rather than negating `ENTITLEMENT`.
 */
const PAID_UNAWARE_ACCESS_MODELS = [DeckAccessModel.FREE];

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deckAccess: DeckAccessService,
    private readonly projection: ContentAccessProjectionService,
  ) {}

  /**
   * The active release's manifest, as it was published.
   *
   * Nothing is filtered here and nothing needs to be: the manifest describes a
   * release rather than its contents — locales, the minimum client, the change
   * cursor, the checksummed list of the bundle's own JSON documents and the
   * signature over them. It names no entity, card or asset and carries no
   * asset URL, so there is no paid material in it to withhold. The projection
   * is applied where material is actually handed out: the entity endpoint, the
   * change feed, and the deck cards route the entitlement guard already holds.
   */
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

  /**
   * The catalog, as far as this client build can read it.
   *
   * A build that does not understand `Deck.access` is served the catalog it
   * has always been served: every free deck, and no locked one. The filter is
   * in the query rather than over the page so that pagination is unaffected —
   * an old client gets full pages of the decks it can use, not a page of
   * fifty with three survivors.
   */
  async listDecks(
    locale: string,
    cursorValue: string | undefined,
    limit: number,
    capability: ClientCapability,
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
        ...(capability.paidContent
          ? {}
          : { accessModel: { in: PAID_UNAWARE_ACCESS_MODELS } }),
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
    // The catalog is open to everyone, locked decks included: a deck nobody
    // can discover is a deck nobody buys. What it carries is the policy —
    // which right opens it and which offers grant that right — never its
    // cards and never a price.
    const access = await this.deckAccess.policiesFor(pageItems);
    const items = pageItems.map((deck) =>
      this.mapDeck(deck, candidates, this.accessOf(access, deck)),
    );
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

  /**
   * One deck's page, for a client build that could have found it.
   *
   * A locked deck is not there for a build that cannot render it, and "not
   * there" is a 404 rather than a refusal: the deck is absent from that
   * client's catalog and from its change feed, so the honest answer to a
   * request for it is the one an unpublished deck gets.
   */
  async getDeck(
    deckId: string,
    locale: string,
    capability: ClientCapability,
  ): Promise<Record<string, unknown>> {
    const [{ manifest }, deck] = await Promise.all([
      this.getManifest(),
      this.prisma.deck.findFirst({
        where: {
          id: deckId,
          status: DeckStatus.PUBLISHED,
          ...(capability.paidContent
            ? {}
            : { accessModel: { in: PAID_UNAWARE_ACCESS_MODELS } }),
        },
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

    const access = await this.deckAccess.policiesFor([deck]);
    return this.mapDeck(
      deck,
      localeCandidates(locale, manifest.defaultLocale),
      this.accessOf(access, deck),
    );
  }

  /**
   * A country as the free product knows it.
   *
   * This is a projection of the canonical entity, not a serialization of it.
   * Germany's row holds every symbol she has; a coat of arms that only a paid
   * deck teaches is one of them, and it does not appear here — not the
   * drawing, not its licence, not its URL. Her flag does, because a free deck
   * teaches it. The route carries no account context and never will: an
   * answer that varied by bearer could not be cached in front of the service
   * without eventually being handed to the wrong reader (ADR-019). An owner
   * gets the closed material from the guarded deck cards route instead, which
   * carries everything a card needs.
   */
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
    // An entity only a paid deck teaches — a U.S. state of the states deck —
    // is not in the public projection at all, and answers the way anything
    // absent from it answers. The message is the one a missing id gets, so
    // the route cannot be used to tell "bought by nobody here" from "never
    // existed".
    const entityVisibility = await this.projection.entityVisibility([
      entity.id,
    ]);
    if (!isPubliclyVisible(entityVisibility.get(entity.id) ?? "PAID_ONLY")) {
      throw new NotFoundException("Entity was not found");
    }
    const assetVisibility = await this.projection.assetVisibility(
      entity.assets.map(({ id }) => id),
    );
    const publicAssets = entity.assets.filter((asset) =>
      isPubliclyVisible(assetVisibility.get(asset.id) ?? "PAID_ONLY"),
    );

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
      assets: publicAssets.map((asset) => this.mapAsset(asset)),
      facts: mapBackSideFacts(entity.facts, locale),
      contentVersion: entity.contentVersion,
    };
  }

  /**
   * What changed in the public catalog since a cursor, for anybody at all.
   *
   * The feed stays unauthenticated, and that is what makes it dangerous: an
   * event names a resource by id, so publishing "asset 8f3c… changed" to a
   * stranger tells them a drawing they may not have exists, gives them an id
   * to ask about, and — before the entity route was closed — an entity to
   * fetch it through. So a change to material only a paid deck reaches is not
   * published here.
   *
   * Nothing is stranded by that. Every publish already re-announces every deck
   * of the release, so the owner of a locked deck is told to look again by the
   * `DECK` event, which names a deck the catalog publishes to everyone anyway;
   * a per-deck `contentRevision` that makes the same signal precise is
   * contract work for the client that acts on it.
   *
   * A filtered page can come back shorter than `limit`, or empty while
   * `hasMore` is true. The cursor is computed from the page the database
   * returned rather than from what survived, so it always advances and a
   * client paging through a release that is mostly paid still terminates.
   *
   * A build that does not understand the paid-deck contract is filtered
   * harder still: it hears about no locked deck at all, because an `UPSERT`
   * naming one would be the first that build ever learned of a deck it cannot
   * draw.
   */
  async listChanges(
    after: string | undefined,
    limit: number,
    capability: ClientCapability,
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
      items: (await this.publicChanges(pageItems, capability)).map(
        (change) => ({
          operation: change.operation,
          resourceType: change.resourceType,
          resourceId: change.resourceId,
          contentVersion: change.contentVersion,
        }),
      ),
      nextCursor: encodeContentChangeCursor(
        pointer.contentVersion,
        nextSequence,
      ),
      hasMore,
      contentVersion: pointer.contentVersion,
    };
  }

  /**
   * The changes of a page that the public projection is allowed to announce.
   *
   * A `DECK` event always survives: the catalog publishes every deck to
   * everybody, locked ones included, so saying that one changed reveals
   * nothing that `GET /v1/decks` does not already hand over — and it is the
   * signal an owner needs to come back for the deck's cards.
   *
   * A `RETIRE` always survives too, and that is a correctness requirement
   * rather than a concession. Retiring a card deletes its deck memberships,
   * so by the time anybody reads the event the card is reachable through
   * nothing and would classify as closed — the one operation whose whole
   * purpose is to tell a client to forget something would be the operation
   * nobody was told about, and every free client would keep withdrawn content
   * for good. It gives nothing away either: the id names something that is
   * going away, no route will serve it, and a reader who never had it deletes
   * nothing.
   *
   * What is left — an `UPSERT` — is announced only when the material it names
   * is in the public projection. A `FACT` is judged by the entity it belongs
   * to, so that closing an entity closes the statements about it too; the
   * publisher does not emit fact events today, and this is here so that the
   * day it does is not the day the feed reopens.
   *
   * For a client build that predates the paid-deck contract the `DECK`
   * exception is withdrawn — a locked deck it cannot render is not a deck it
   * should be told changed — and the projection narrows to `PUBLIC`, so a
   * locked deck's preview material stays out too. What remains is the feed
   * that build has always read.
   */
  private async publicChanges<
    Change extends {
      operation: ContentChangeOperation;
      resourceType: ContentResourceType;
      resourceId: string;
    },
  >(changes: Change[], capability: ClientCapability): Promise<Change[]> {
    const upserts = changes.filter(
      ({ operation }) => operation === ContentChangeOperation.UPSERT,
    );
    const idsOf = (resourceType: ContentResourceType): string[] => [
      ...new Set(
        upserts
          .filter((change) => change.resourceType === resourceType)
          .map(({ resourceId }) => resourceId),
      ),
    ];

    const factIds = idsOf(ContentResourceType.FACT);
    const facts =
      factIds.length === 0
        ? []
        : await this.prisma.fact.findMany({
            where: { id: { in: factIds } },
            select: { id: true, geoEntityId: true },
          });
    const entityOfFact = new Map(
      facts.map(({ id, geoEntityId }) => [id, geoEntityId]),
    );

    const deckIds = idsOf(ContentResourceType.DECK);
    const [assets, cards, entities, renderableDeckIds] = await Promise.all([
      this.projection.assetVisibility(idsOf(ContentResourceType.ASSET)),
      this.projection.cardVisibility(idsOf(ContentResourceType.LEARNING_CARD)),
      this.projection.entityVisibility([
        ...new Set([
          ...idsOf(ContentResourceType.ENTITY),
          ...entityOfFact.values(),
        ]),
      ]),
      this.renderableDeckIds(deckIds, capability),
    ]);
    const visible = (visibility: ContentVisibility | undefined): boolean =>
      isVisibleToClient(visibility ?? "PAID_ONLY", capability.paidContent);

    return changes.filter((change) => {
      if (change.operation === ContentChangeOperation.RETIRE) {
        return true;
      }
      switch (change.resourceType) {
        case ContentResourceType.DECK:
          return renderableDeckIds.has(change.resourceId);
        case ContentResourceType.ASSET:
          return visible(assets.get(change.resourceId));
        case ContentResourceType.LEARNING_CARD:
          return visible(cards.get(change.resourceId));
        case ContentResourceType.ENTITY:
          return visible(entities.get(change.resourceId));
        case ContentResourceType.FACT: {
          const entityId = entityOfFact.get(change.resourceId);
          // A fact whose entity has been deleted outright is announced: the
          // client is being told to forget something, and there is nothing
          // left to leak.
          return entityId === undefined || visible(entities.get(entityId));
        }
      }
    });
  }

  /**
   * Which of these decks the client build can draw.
   *
   * Every one of them, for a build that understands the access model: the
   * catalog publishes locked decks to everybody, so announcing that one
   * changed reveals nothing `GET /v1/decks` does not already hand over, and it
   * is the signal an owner needs to come back for the cards.
   *
   * For an older build the question is worth a query, because the answer is
   * the difference between "your catalog gained a deck" and "your catalog
   * gained a deck that opens on a 403".
   */
  private async renderableDeckIds(
    deckIds: string[],
    capability: ClientCapability,
  ): Promise<Set<string>> {
    if (capability.paidContent || deckIds.length === 0) {
      return new Set(deckIds);
    }
    const decks = await this.prisma.deck.findMany({
      where: {
        id: { in: deckIds },
        accessModel: { in: PAID_UNAWARE_ACCESS_MODELS },
      },
      select: { id: true },
    });
    return new Set(decks.map(({ id }) => id));
  }

  /**
   * A deck's cards, for whoever is allowed to read them.
   *
   * This is the closed half of the catalog. `userId` is null for a request
   * that carried no bearer at all — a guest reading a free deck — and the
   * guard turns that into a 403 for a deck that needs buying, never into a
   * shorter page: a caller must be able to tell "not bought" from "empty".
   */
  async listDeckCards(
    deckId: string,
    userId: string | null,
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
        select: {
          id: true,
          accessModel: true,
          requiredEntitlementKey: true,
        },
      }),
    ]);
    if (deck === null) {
      throw new NotFoundException("Deck was not found");
    }
    // Before a single card is read. The order is deliberate: a deck that does
    // not exist is a 404 whoever asks, and a deck that exists but was not
    // bought is a 403 that names the offers which would fix that.
    await this.deckAccess.requireAccess(deck, userId);

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

  /**
   * The policy of a deck the catalog just read. Present for every deck the
   * map was built from; the fallback repeats what the row itself says rather
   * than inventing a free deck out of a missing entry.
   */
  private accessOf(
    policies: Map<string, DeckAccessPolicy>,
    deck: DeckAccessSubject,
  ): DeckAccessPolicy {
    return policies.get(deck.id) ?? { model: deck.accessModel };
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
    access: DeckAccessPolicy,
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
      access,
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
