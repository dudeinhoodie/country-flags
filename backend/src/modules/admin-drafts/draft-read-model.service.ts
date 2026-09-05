import { Injectable } from "@nestjs/common";
import { AssetStatus, AssetType } from "@prisma/client";
import type { ContentDraft, DraftAsset } from "@prisma/client";

import { PrismaService } from "../../infrastructure/database/prisma.service";
import type { ContentVisibility } from "../content/content-access-projection.service";
import { ContentAccessProjectionService } from "../content/content-access-projection.service";
import { AdminDraftsService } from "./admin-drafts.service";
import { CARD_TEMPLATES } from "./deck-cards";
import type { EditorialDeck, MembershipContext } from "./deck-membership";
import { assetSlotKey, indexDraftReach } from "./draft-reach";
import type { DraftDeckCard, DraftReachIndex } from "./draft-reach";
import { withFindingRoutes } from "./draft-validation.service";
import type {
  PublishedDeckAccess,
  ValidationFinding,
  ValidationReport,
} from "./draft-validation.service";
import { DraftValidationService } from "./draft-validation.service";
import { TaxonomySourceService } from "./taxonomy-source.service";

/**
 * What the console is told about who may see a thing. It is the projection's
 * own vocabulary, not a second one: the badge in the media editor and the
 * decision the public API makes are the same verdict (#356, §7.4).
 */
export type DeliveryStatus = ContentVisibility;

/** The entity as the editorial document holds it, structurally. */
interface CatalogEntity {
  key: string;
  type: string;
  status: string;
  config: { includeInCountryCatalog: boolean };
  parentKey?: string | null;
  identifiers?: Record<string, string>;
  overrides?: Record<string, unknown>;
}

export interface EditorialCatalog extends Record<string, unknown> {
  supportedLocales: string[];
  entities: CatalogEntity[];
  decks: EditorialDeck[];
}

/** Which of the locales a release must serve this object already has. */
export interface LocaleCompleteness {
  required: string[];
  present: string[];
  missing: string[];
  complete: boolean;
}

export function localeCompleteness(
  required: string[],
  present: Iterable<string>,
): LocaleCompleteness {
  const have = new Set(present);
  const covered = required.filter((locale) => have.has(locale));
  const missing = required.filter((locale) => !have.has(locale));
  return {
    required,
    present: covered,
    missing,
    complete: missing.length === 0,
  };
}

/** What the active release already knows about an entity. */
export interface PublishedEntityContext {
  names: Map<string, string>;
  assetTypes: Set<AssetType>;
}

/**
 * Everything the aggregated admin screens read, gathered once.
 *
 * The point of the read models is that an entity list of 250 rows and a deck
 * of 50 cards each cost a fixed handful of queries rather than one per row
 * (#356). So the expensive parts — the published names and symbols, the
 * draft's uploads, the taxonomy, the release's deck access — are fetched
 * together here, and every projection below is computed from this in memory.
 */
export interface DraftContext {
  draft: ContentDraft;
  catalog: EditorialCatalog;
  membership: MembershipContext;
  reach: DraftReachIndex;
  draftAssets: DraftAsset[];
  publishedDecks: PublishedDeckAccess[];
  published: Map<string, PublishedEntityContext>;
  report: ValidationReport;
}

/** How far an uploaded drawing has got through the pipeline. */
export type AssetProcessingState = "PROCESSING" | "READY" | "FAILED";

export function processingStateOf(asset: DraftAsset): AssetProcessingState {
  switch (asset.validationStatus) {
    case "VALID":
      return "READY";
    case "INVALID":
      return "FAILED";
    default:
      return "PROCESSING";
  }
}

/** The asset slots the media editor shows, in the order it shows them. */
export const ASSET_SLOTS: readonly AssetType[] = [
  AssetType.FLAG,
  AssetType.COAT_OF_ARMS,
  AssetType.MAP,
  AssetType.OTHER,
];

/**
 * The prompt asset a template reads, as the database names it. The editorial
 * layer writes `coat_of_arms` in lower case and the enum writes it in upper;
 * the console speaks the enum, because that is what an upload carries.
 */
export function promptAssetTypeEnum(templateCode: string): AssetType | null {
  const template = CARD_TEMPLATES[templateCode];
  return template === undefined ? null : template.promptAssetType;
}

/**
 * A drawing the sources provide for anything the catalog teaches.
 *
 * Flags arrive from upstream at build time, which is why the publish gate
 * blocks on a missing coat of arms and not on a missing flag. The candidate
 * search and the deck summary have to agree with the gate, or the console
 * would refuse a card the release would happily build.
 */
export function isSourcedAssetType(assetType: AssetType): boolean {
  return assetType === AssetType.FLAG;
}

@Injectable()
export class DraftReadModelService {
  constructor(
    private readonly database: PrismaService,
    private readonly drafts: AdminDraftsService,
    private readonly taxonomy: TaxonomySourceService,
    private readonly validation: DraftValidationService,
    private readonly projection: ContentAccessProjectionService,
  ) {}

  /** The whole aggregated context for one draft, in five queries. */
  async context(draftId: string): Promise<DraftContext> {
    const draft = await this.drafts.get(draftId);
    // A stored document always carries these, but a caller need not: the
    // projections below iterate them, and an absent list should read as an
    // empty catalog rather than as a crash.
    const stored = draft.document as unknown as Partial<EditorialCatalog>;
    const catalog: EditorialCatalog = {
      ...(stored as EditorialCatalog),
      supportedLocales: stored.supportedLocales ?? [],
      entities: stored.entities ?? [],
      decks: stored.decks ?? [],
    };
    const [relations, draftAssets, publishedDecks, published] =
      await Promise.all([
        this.taxonomy.publishedRelations(),
        this.database.draftAsset.findMany({
          where: { draftId },
          orderBy: [{ entityContentKey: "asc" }, { assetType: "asc" }],
        }),
        this.drafts.publishedDeckAccess(),
        this.publishedContext(catalog.entities.map((entity) => entity.key)),
      ]);
    const membership: MembershipContext = {
      entities: catalog.entities,
      relations: this.taxonomy.merge(relations, catalog.additionalRelations),
    };
    const report = withFindingRoutes(
      this.validation.validate(
        catalog,
        membership,
        draftAssets.map((asset) => ({
          entityContentKey: asset.entityContentKey,
          assetType: asset.assetType.toLowerCase(),
          licenseName: asset.licenseName,
          sourceUrl: asset.sourceUrl,
          replacementReason: asset.replacementReason,
        })),
        publishedDecks,
      ),
      draftId,
    );
    return {
      draft,
      catalog,
      membership,
      reach: indexDraftReach(catalog.decks, membership),
      draftAssets,
      publishedDecks,
      published,
      report,
    };
  }

  /**
   * What the draft's decks make of each entity: public, previewed or paid.
   *
   * An entity no card teaches is public, exactly as the release projection
   * treats one — a region is structure rather than merchandise.
   */
  async entityDelivery(
    keys: string[],
    reach: DraftReachIndex,
  ): Promise<Map<string, DeliveryStatus>> {
    return this.projection.visibilityByReach(keys, reach.byEntity, "PUBLIC");
  }

  /**
   * What the draft's decks make of each `entity#ASSET_TYPE` slot.
   *
   * A drawing no card prompts with is paid-only for the same reason the
   * release withholds one: no route serves it, so publishing it would put
   * artwork on a public URL that nothing has decided is free.
   */
  async assetSlotDelivery(
    slotKeys: string[],
    reach: DraftReachIndex,
  ): Promise<Map<string, DeliveryStatus>> {
    return this.projection.visibilityByReach(
      slotKeys,
      reach.byAssetSlot,
      "PAID_ONLY",
    );
  }

  /** The same, per resolved card. */
  async cardDelivery(
    cardIds: string[],
    reach: DraftReachIndex,
  ): Promise<Map<string, DeliveryStatus>> {
    return this.projection.visibilityByReach(
      cardIds,
      reach.byCard,
      "PAID_ONLY",
    );
  }

  /** The findings about one object, ready to be shown beside it. */
  findingsFor(report: ValidationReport, subject: string): ValidationFinding[] {
    return report.findings.filter((finding) => finding.subject === subject);
  }

  /** Blocking and warning counts of a set of findings. */
  static counts(findings: ValidationFinding[]): {
    blocking: number;
    warnings: number;
  } {
    return {
      blocking: findings.filter((finding) => finding.level === "blocking")
        .length,
      warnings: findings.filter((finding) => finding.level === "warning")
        .length,
    };
  }

  /**
   * Which locales already name an entity.
   *
   * A name reaches a release from two directions: the active release already
   * serves one, or the draft pins one as an override. Either counts, because
   * either is what the build will publish.
   */
  entityLocales(
    entity: CatalogEntity,
    supportedLocales: string[],
    published: PublishedEntityContext | undefined,
  ): LocaleCompleteness {
    const present = new Set(published?.names.keys() ?? []);
    for (const path of Object.keys(entity.overrides ?? {})) {
      const match = /^names\.([A-Za-z0-9-]+)(?:\..+)?$/.exec(path);
      if (match?.[1] !== undefined) {
        present.add(match[1]);
      }
    }
    return localeCompleteness(supportedLocales, present);
  }

  /** The decks that hold a card about this entity, in a readable order. */
  usagesOf(reach: DraftReachIndex, entityKey: string): DraftDeckCard[] {
    return [...(reach.usageByEntity.get(entityKey) ?? [])].sort(
      (left, right) =>
        left.deckKey.localeCompare(right.deckKey) ||
        left.cardId.localeCompare(right.cardId),
    );
  }

  /** The slot key the delivery map is keyed by. */
  slotKey(entityKey: string, assetType: AssetType): string {
    return assetSlotKey(entityKey, assetType);
  }

  /**
   * One query for the names and symbols the active release already carries.
   *
   * Names come back for every locale rather than only English: the entity
   * list has to say which locales are missing, and asking per row is exactly
   * the N+1 this endpoint exists to avoid.
   */
  private async publishedContext(
    keys: string[],
  ): Promise<Map<string, PublishedEntityContext>> {
    if (keys.length === 0) {
      return new Map();
    }
    const rows = await this.database.geoEntity.findMany({
      where: { contentKey: { in: keys } },
      select: {
        contentKey: true,
        names: {
          where: { isPrimary: true, nameType: "SHORT" },
          select: { locale: true, value: true },
        },
        assets: {
          where: { status: AssetStatus.PUBLISHED },
          select: { assetType: true },
        },
      },
    });
    const byKey = new Map<string, PublishedEntityContext>();
    for (const row of rows) {
      byKey.set(row.contentKey, {
        names: new Map(row.names.map((name) => [name.locale, name.value])),
        assetTypes: new Set(row.assets.map((asset) => asset.assetType)),
      });
    }
    return byKey;
  }
}
