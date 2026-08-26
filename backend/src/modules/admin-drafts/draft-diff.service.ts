import { Injectable } from "@nestjs/common";
import { CardStatus, DeckStatus } from "@prisma/client";

import { PrismaService } from "../../infrastructure/database/prisma.service";
import { deckCodeFromKey } from "../content/bundle/bundle-mapper";
import { CatalogSourceService } from "./catalog-source.service";
import { membersMode, resolveDeckMembers } from "./deck-membership";
import type {
  EditorialDeck,
  EditorialEntity,
  MembershipContext,
} from "./deck-membership";

export interface DeckDiffEntry {
  /** Editorial key, absent for a deck only the release still carries. */
  deckKey: string | null;
  /** Published code, absent for a deck the release does not carry yet. */
  publishedCode: string | null;
  change: "added" | "removed" | "changed";
  details: string[];
}

export interface AssetDiffEntry {
  entityContentKey: string;
  assetType: string;
  change: "replaced" | "added";
  reason: string | null;
}

export interface EntityDiffEntry {
  entityKey: string;
  details: string[];
}

export interface DraftDiff {
  baseContentVersion: string;
  isEmpty: boolean;
  decks: DeckDiffEntry[];
  assets: AssetDiffEntry[];
  entities: EntityDiffEntry[];
}

interface EditorialCatalogDocument {
  entities: EditorialEntity[];
  decks: EditorialDeck[];
}

/** The full editorial record, as far as the diff needs to read it. */
interface EditorialEntityDocument extends Record<string, unknown> {
  key: string;
  overrides?: Record<string, unknown>;
}

const ENTITY_SCALAR_FIELDS = [
  "type",
  "status",
  "recognitionStatus",
  "recognitionAsOf",
  "validFrom",
  "validTo",
] as const;

/** The document nests toggles in config; the diff names them flat. */
function entityToggle(entity: Record<string, unknown>): unknown {
  return (entity.config as Record<string, unknown> | undefined)
    ?.includeInCountryCatalog;
}

function scalarText(value: unknown): string {
  if (value === undefined) {
    return "—";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * An editorial deck key and a published deck code are two namespaces, and a
 * diff entry names both rather than one field that silently switches between
 * them: a deck the draft adds has no published code yet, and a deck the draft
 * drops has no editorial key any more.
 *
 * The release build derives one from the other: the
 * release build derives `Deck.code` from `deck.key`, so comparing them
 * directly would report every deck as new. The diff maps through the
 * publisher's own derivation, which is the only thing guaranteed to agree
 * with what a release actually produces.
 *
 * What a release built from this draft would change, said in the domain's
 * own words — decks, membership and replaced drawings — rather than as a
 * JSON patch. An editor decides whether to propose from this, and a JSON
 * patch is not a thing anyone can decide from.
 *
 * Entity facts derived from upstream sources are deliberately absent: the
 * console does not own them (ADR-014 §4), so a diff that claimed to show
 * them would be showing noise from the last source refresh.
 */
@Injectable()
export class DraftDiffService {
  constructor(
    private readonly database: PrismaService,
    private readonly catalogSource: CatalogSourceService,
  ) {}

  async diff(
    draft: {
      id: string;
      baseContentVersion: string;
      document: unknown;
    },
    context: MembershipContext,
  ): Promise<DraftDiff> {
    const catalog = draft.document as EditorialCatalogDocument;
    const published = await this.database.deck.findMany({
      where: { status: DeckStatus.PUBLISHED },
      include: {
        localizations: true,
        _count: {
          select: {
            cards: { where: { learningCard: { status: CardStatus.ACTIVE } } },
          },
        },
      },
    });
    const publishedByCode = new Map(published.map((deck) => [deck.code, deck]));

    const decks: DeckDiffEntry[] = [];
    for (const deck of catalog.decks) {
      const counterpart = publishedByCode.get(deckCodeFromKey(deck.key));
      if (counterpart === undefined) {
        decks.push({
          deckKey: deck.key,
          publishedCode: null,
          change: "added",
          details: [
            `New ${membersMode(deck.members)} deck holding ${String(
              this.safeCount(deck, context),
            )} countries`,
          ],
        });
        continue;
      }
      const details: string[] = [];
      const memberCount = this.safeCount(deck, context);
      if (memberCount !== counterpart._count.cards) {
        details.push(
          `Countries: ${String(counterpart._count.cards)} → ${String(memberCount)}`,
        );
      }
      for (const localization of counterpart.localizations) {
        const locale = localization.locale.toLowerCase();
        const next = deck.names[locale];
        if (next === undefined) {
          details.push(`Localization removed: ${locale}`);
          continue;
        }
        if (next.name !== localization.name) {
          details.push(
            `Name (${locale}): "${localization.name}" → "${next.name}"`,
          );
        }
        if (next.description !== localization.description) {
          details.push(`Description (${locale}) changed`);
        }
      }
      const publishedLocales = new Set(
        counterpart.localizations.map(({ locale }) => locale.toLowerCase()),
      );
      for (const locale of Object.keys(deck.names)) {
        if (!publishedLocales.has(locale)) {
          details.push(`Localization added: ${locale}`);
        }
      }
      if (details.length > 0) {
        decks.push({
          deckKey: deck.key,
          publishedCode: counterpart.code,
          change: "changed",
          details,
        });
      }
    }

    const draftDeckCodes = new Set(
      catalog.decks.map((deck) => deckCodeFromKey(deck.key)),
    );
    for (const deck of published) {
      if (!draftDeckCodes.has(deck.code)) {
        decks.push({
          deckKey: null,
          publishedCode: deck.code,
          change: "removed",
          details: [`Was publishing ${String(deck._count.cards)} countries`],
        });
      }
    }

    const uploaded = await this.database.draftAsset.findMany({
      where: { draftId: draft.id },
      orderBy: [{ entityContentKey: "asc" }],
    });
    const assets: AssetDiffEntry[] = uploaded.map((asset) => ({
      entityContentKey: asset.entityContentKey,
      assetType: asset.assetType,
      change: "replaced",
      reason: asset.replacementReason,
    }));

    const entities = this.entityDiff(catalog);

    return {
      baseContentVersion: draft.baseContentVersion,
      isEmpty:
        decks.length === 0 && assets.length === 0 && entities.length === 0,
      decks: decks.sort((left, right) =>
        (left.deckKey ?? left.publishedCode ?? "").localeCompare(
          right.deckKey ?? right.publishedCode ?? "",
        ),
      ),
      assets,
      entities,
    };
  }

  /**
   * What the draft changed about the editorial entities, against the catalog
   * this deployment was built from — the same base a proposal will refuse to
   * leave (`CATALOG_MOVED_ON`), so the comparison cannot silently drift.
   * Entities cannot be created or deleted editorially, so every entry is a
   * change of an existing record.
   */
  private entityDiff(catalog: EditorialCatalogDocument): EntityDiffEntry[] {
    let baseEntities: EditorialEntityDocument[];
    try {
      baseEntities = (
        this.catalogSource.read().document as EditorialCatalogDocument
      ).entities as unknown as EditorialEntityDocument[];
    } catch {
      // A deployment without its catalog file cannot say what changed; the
      // proposal path reports that loudly, a diff must not hide the deck and
      // asset entries behind it.
      return [];
    }
    const baseByKey = new Map(baseEntities.map((entry) => [entry.key, entry]));
    const entries: EntityDiffEntry[] = [];
    for (const entity of catalog.entities as unknown as EditorialEntityDocument[]) {
      const base = baseByKey.get(entity.key);
      if (base === undefined) {
        continue;
      }
      const details: string[] = [];
      for (const field of ENTITY_SCALAR_FIELDS) {
        if (scalarText(base[field]) !== scalarText(entity[field])) {
          details.push(
            `${field}: ${scalarText(base[field])} → ${scalarText(entity[field])}`,
          );
        }
      }
      if (scalarText(entityToggle(base)) !== scalarText(entityToggle(entity))) {
        details.push(
          `includeInCountryCatalog: ${scalarText(entityToggle(base))} → ${scalarText(entityToggle(entity))}`,
        );
      }
      const baseIdentifiers = (base.identifiers ?? {}) as Record<
        string,
        string
      >;
      const nextIdentifiers = (entity.identifiers ?? {}) as Record<
        string,
        string
      >;
      for (const key of new Set([
        ...Object.keys(baseIdentifiers),
        ...Object.keys(nextIdentifiers),
      ])) {
        if (baseIdentifiers[key] !== nextIdentifiers[key]) {
          details.push(
            `identifiers.${key}: ${scalarText(baseIdentifiers[key])} → ${scalarText(nextIdentifiers[key])}`,
          );
        }
      }
      const baseOverrides = base.overrides ?? {};
      const nextOverrides = entity.overrides ?? {};
      for (const path of new Set([
        ...Object.keys(baseOverrides),
        ...Object.keys(nextOverrides),
      ])) {
        const before = baseOverrides[path];
        const after = nextOverrides[path];
        if (JSON.stringify(before) === JSON.stringify(after)) {
          continue;
        }
        if (before === undefined) {
          details.push(`override ${path} set to ${JSON.stringify(after)}`);
        } else if (after === undefined) {
          details.push(
            `override ${path} removed (was ${JSON.stringify(before)})`,
          );
        } else {
          details.push(
            `override ${path}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`,
          );
        }
      }
      if (details.length > 0) {
        entries.push({ entityKey: entity.key, details });
      }
    }
    return entries.sort((left, right) =>
      left.entityKey.localeCompare(right.entityKey),
    );
  }

  /**
   * A deck that cannot be resolved counts as zero here; validation is what
   * reports it as an error, and a diff that threw would hide every other
   * change behind one broken deck.
   */
  private safeCount(deck: EditorialDeck, context: MembershipContext): number {
    try {
      return resolveDeckMembers(deck, context).length;
    } catch {
      return 0;
    }
  }
}
