import { HttpStatus, Injectable } from "@nestjs/common";
import { AssetType } from "@prisma/client";
import type { AdminUser, ContentDraft, DraftAsset } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminDraftsService } from "./admin-drafts.service";
import { CARD_TEMPLATES } from "./deck-cards";
import { liftEditorialDocumentToV3 } from "./editorial-document.service";
import {
  ASSET_SLOTS,
  DraftReadModelService,
  localeCompleteness,
  processingStateOf,
} from "./draft-read-model.service";
import type {
  AssetProcessingState,
  DeliveryStatus,
  DraftContext,
  LocaleCompleteness,
} from "./draft-read-model.service";
import type { ValidationFinding } from "./draft-validation.service";

/** Every type an entity can be. A subdivision is a state, not a country. */
export type EntityType =
  | "country"
  | "territory"
  | "area"
  | "subdivision"
  | "region"
  | "subregion";

/** What a subdivision may hang from: it is a unit of a state, not of a region. */
const PARENT_TYPES: readonly EntityType[] = ["country", "territory"];

/**
 * A subdivision is not recognized or unrecognized — the question does not
 * apply to it — and the editorial schema pins the answer (ADR-020).
 */
const SUBDIVISION_RECOGNITION_STATUS = "not_applicable";

/**
 * The editorial record of an entity: the selection and the hand-made
 * corrections, never the merged result. Names and facts come from upstream
 * sources at build time; what an editor owns is whether the entity is in
 * the catalog, how it is coded, and which fields the `overrides` layer
 * pins on purpose (each key a dotted path, e.g. `names.ru.short`).
 */
export interface EditorialEntityRecord extends Record<string, unknown> {
  key: string;
  type: EntityType;
  status: "active" | "historical" | "retired" | "hidden";
  /**
   * The country or territory an administrative unit belongs to. Authoring
   * convenience: the publisher normalizes it into the canonical CONTAINS
   * relation. Required of a subdivision and absent from everything else.
   */
  parentKey?: string;
  /** Presentation toggles (ADR-015); they never gate learnability. */
  config: {
    includeInCountryCatalog: boolean;
    /**
     * Fact types the entity does not have by its nature (#272). The console
     * neither shows nor sets it — an edit spreads the stored config, so the
     * declaration survives one — and the pipeline is what reads it.
     */
    factsNotApplicable?: string[];
  };
  recognitionStatus: string;
  recognitionAsOf?: string;
  validFrom?: string;
  validTo?: string;
  identifiers?: Record<string, string>;
  overrides?: Record<string, unknown>;
}

/** A number a source measured, with what it counts and when it looked. */
export interface EntityMeasuredValue {
  value: number;
  unit?: string;
  observedAt?: string;
}

/**
 * The facts a curator writes by hand: a state's admission date, a capital,
 * a motto. They are answers to questions rather than free-form strings, so
 * the API gives each one a field of its own.
 */
export interface EntityFacts {
  capital?: Record<string, string>;
  largestCity?: Record<string, string>;
  motto?: Record<string, string>;
  statehoodDate?: string;
  population?: EntityMeasuredValue;
  area?: EntityMeasuredValue;
  languages?: Record<string, string>[];
}

/**
 * The API keeps the toggle flat: nesting is document structure, and the
 * console's screens should not have to know where a toggle happens to live
 * in the editorial file. `facts` is flat for a different reason — in the
 * document it is a group of override paths (see `factsFromOverrides`).
 */
export type ApiEntityRecord = Omit<
  EditorialEntityRecord,
  "config" | "parentKey"
> & {
  includeInCountryCatalog: boolean;
  parentKey: string | null;
  facts?: EntityFacts;
};

/** The prefix every fact override path starts with. */
const FACT_PREFIX = "facts.";
const LOCALIZED_FACTS = ["capital", "largestCity", "motto"] as const;
const MEASURED_FACTS = ["population", "area"] as const;

/**
 * The name a fact is stored under, where it cannot be its own.
 *
 * The build reads four names straight out of `entity.facts` — `capitals`,
 * `currencies`, `languages` and `population` (`FACT_TYPES` in
 * `tools/content-pipeline/src/merge.ts`) — and an editorial override carries
 * the pipeline's highest priority. Two of the console's fields collide with
 * that, and a collision here does not go quietly: a published language is
 * `{code, role, names}` per entry and a published population is
 * `{value, year}`, neither of which is what this form holds, so the override
 * would replace a correct source fact with a differently shaped one.
 *
 * They are stored under a name no build reads instead. Like the rest of the
 * form — `capital` is not `capitals`, and a motto is no fact type at all —
 * the value is inert until #351 gives editorial facts a path of their own;
 * inert is the point, because the alternative is wrong. The name stays under
 * `facts.`, which the build strips from the entity before the catalog is
 * written, so nothing here can reach published content by another door.
 */
const STORED_FACT_NAME: Record<string, string> = {
  languages: "editorialLanguages",
  population: "editorialPopulation",
};
const API_FACT_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(STORED_FACT_NAME).map(([field, stored]) => [stored, field]),
);

function storedFactName(field: string): string {
  return STORED_FACT_NAME[field] ?? field;
}

/**
 * Reads the typed facts back out of the override map.
 *
 * The editorial schema has no `facts` object on an entity: the layer that
 * carries hand-made values is `overrides`, whose dotted paths are applied
 * with the pipeline's highest priority. So a curator's capital is the
 * override `facts.capital.en`, and this projection is what turns the map
 * the document stores into the shape the console edits. Two of the names
 * differ from the API field they carry — see `STORED_FACT_NAME`.
 */
export function factsFromOverrides(
  overrides: Record<string, unknown> | undefined,
): EntityFacts | undefined {
  if (overrides === undefined) {
    return undefined;
  }
  const facts: EntityFacts = {};
  let found = false;
  for (const [path, value] of Object.entries(overrides)) {
    if (!path.startsWith(FACT_PREFIX)) {
      continue;
    }
    const segments = path.slice(FACT_PREFIX.length).split(".");
    const [stored, locale] = segments;
    if (stored === undefined || segments.length > 2) {
      continue;
    }
    const field = API_FACT_FIELD[stored] ?? stored;
    if (
      locale !== undefined &&
      (LOCALIZED_FACTS as readonly string[]).includes(field) &&
      typeof value === "string"
    ) {
      const bucket = facts[field as (typeof LOCALIZED_FACTS)[number]] ?? {};
      bucket[locale] = value;
      facts[field as (typeof LOCALIZED_FACTS)[number]] = bucket;
      found = true;
      continue;
    }
    if (locale !== undefined) {
      continue;
    }
    if (field === "statehoodDate" && typeof value === "string") {
      facts.statehoodDate = value;
      found = true;
    } else if (
      (MEASURED_FACTS as readonly string[]).includes(field) &&
      typeof value === "object" &&
      value !== null
    ) {
      facts[field as (typeof MEASURED_FACTS)[number]] =
        value as EntityMeasuredValue;
      found = true;
    } else if (field === "languages" && Array.isArray(value)) {
      facts.languages = value as Record<string, string>[];
      found = true;
    }
  }
  return found ? facts : undefined;
}

/** The inverse: the paths one facts form writes into the override map. */
export function factsToOverrides(facts: EntityFacts): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  for (const field of LOCALIZED_FACTS) {
    for (const [locale, value] of Object.entries(facts[field] ?? {})) {
      overrides[`${FACT_PREFIX}${field}.${locale}`] = value;
    }
  }
  for (const field of MEASURED_FACTS) {
    const measured = facts[field];
    if (measured !== undefined) {
      overrides[`${FACT_PREFIX}${storedFactName(field)}`] = measured;
    }
  }
  if (facts.statehoodDate !== undefined) {
    overrides[`${FACT_PREFIX}statehoodDate`] = facts.statehoodDate;
  }
  if (facts.languages !== undefined && facts.languages.length > 0) {
    overrides[`${FACT_PREFIX}${storedFactName("languages")}`] = facts.languages;
  }
  return overrides;
}

function splitOverrides(
  overrides: Record<string, unknown> | null | undefined,
): {
  facts: Record<string, unknown>;
  rest: Record<string, unknown>;
} {
  const facts: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(overrides ?? {})) {
    if (path.startsWith(FACT_PREFIX)) {
      facts[path] = value;
    } else {
      rest[path] = value;
    }
  }
  return { facts, rest };
}

function toApiEntity(entity: EditorialEntityRecord): ApiEntityRecord {
  const { config, parentKey, overrides, ...plain } = entity;
  const split = splitOverrides(overrides);
  const facts = factsFromOverrides(overrides);
  return {
    ...plain,
    includeInCountryCatalog: config.includeInCountryCatalog,
    parentKey: parentKey ?? null,
    // The facts form owns its paths; the raw override table must not show
    // them twice, so what is left is what the form does not cover.
    ...(Object.keys(split.rest).length === 0 ? {} : { overrides: split.rest }),
    ...(facts === undefined ? {} : { facts }),
  };
}

/**
 * What an editor may change; the key names the entity and never moves.
 * `null` on a clearable field means "drop it from the document".
 */
export interface EntityUpdate {
  type?: EditorialEntityRecord["type"];
  status?: EditorialEntityRecord["status"];
  includeInCountryCatalog?: boolean;
  recognitionStatus?: string;
  recognitionAsOf?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  parentKey?: string | null;
  facts?: EntityFacts;
  identifiers?: Record<string, string> | null;
  overrides?: Record<string, unknown> | null;
}

export interface EntityListItem {
  key: string;
  type: string;
  status: string;
  includeInCountryCatalog: boolean;
  recognitionStatus: string;
  identifiers: Record<string, string>;
  /** The administrative parent, so "under the United States" is a filter. */
  parentKey: string | null;
  /**
   * Whether the entity has a symbol of that type at all — published in the
   * active release, or uploaded into this draft. Carried by the list so
   * "missing a coat of arms" costs one query rather than one per row.
   */
  hasFlag: boolean;
  hasCoatOfArms: boolean;
  overrideCount: number;
  /** The short name the active release serves, for the list to be readable. */
  publishedName: string | null;
  /** Which supported locales already name the entity, and which do not. */
  locales: LocaleCompleteness;
  /** How many of the draft's decks teach it, for the "used in decks" column. */
  usedInDeckCount: number;
  /** What the draft's decks make of it: public, previewed or paid-only. */
  delivery: DeliveryStatus;
  /** The validation state of the row, so the list needs no second request. */
  blockingCount: number;
  warningCount: number;
}

/** One slot of the contextual media editor: a flag, a coat of arms, a map. */
export interface EntityAssetSlot {
  assetType: AssetType;
  /** Where the drawing in this slot comes from, or that there is none. */
  state: "empty" | "draft" | "published";
  /**
   * Who may see it, computed by the same policy the public projection uses.
   * Null for an empty slot: there is nothing to deliver yet.
   */
  delivery: DeliveryStatus | null;
  draftAssetId: string | null;
  variant: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  sourceUrl: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
  attribution: string | null;
  replacementReason: string | null;
  /** Whether licence, source and reason are all filled in (the publish gate). */
  provenanceComplete: boolean;
  processing: AssetProcessingState | null;
  validFrom: string | null;
  validTo: string | null;
  /** A drawing whose validity has been closed: history, not the symbol. */
  retired: boolean;
  localizations: LocaleCompleteness;
  /** The cards that prompt with this slot, and the decks that hold them. */
  usedByCardIds: string[];
  usedByDeckKeys: string[];
  /**
   * The templates that become buildable once the slot is filled. An empty
   * slot explains what it would unlock rather than only that it is empty
   * (docs/19-admin-redesign.md §7.1).
   */
  unlocksTemplates: string[];
}

/** One card in one deck that teaches this entity. */
export interface EntityDeckUsage {
  deckKey: string;
  deckName: string | null;
  accessModel: "FREE" | "ENTITLEMENT";
  cardId: string;
  templateCode: string;
  templateSchemaVersion: number;
  assetType: string | null;
  isPreview: boolean;
  delivery: DeliveryStatus;
}

export interface ObjectValidationSummary {
  blocking: number;
  warnings: number;
  findings: ValidationFinding[];
}

export interface EntityDetail {
  entity: ApiEntityRecord;
  /**
   * What the active release currently serves for this entity, locale → short
   * name. Placeholders for the editor: an override the entity does not carry
   * falls back to these at build time.
   */
  publishedNames: Record<string, string>;
  /** The revision this view was read at; the same value `If-Match` takes. */
  draftRevision: number;
  delivery: DeliveryStatus;
  locales: LocaleCompleteness;
  assets: EntityAssetSlot[];
  usages: EntityDeckUsage[];
  validation: ObjectValidationSummary;
}

/** One page of the entity list, and how much the filters matched. */
export interface EntityListPage {
  items: EntityListItem[];
  total: number;
  /** The revision this view was read at; the same value `If-Match` takes. */
  draftRevision: number;
}

/** What the entity list may be narrowed by, all of it server-side. */
export interface EntityListFilter {
  search?: string | undefined;
  type?: string | undefined;
  parentKey?: string | undefined;
  status?: string | undefined;
  includeInCountryCatalog?: boolean | undefined;
  missingFlag?: boolean | undefined;
  missingCoatOfArms?: boolean | undefined;
  missingLocalization?: boolean | undefined;
  validation?: "ok" | "warning" | "blocking" | undefined;
  usedInDecks?: boolean | undefined;
  offset: number;
  limit: number;
}

interface EditorialCatalogDocument extends Record<string, unknown> {
  entities: EditorialEntityRecord[];
}

function asCatalog(document: unknown): EditorialCatalogDocument {
  return document as EditorialCatalogDocument;
}

function entityNotFound(entityKey: string): never {
  throw new ApiException(
    HttpStatus.NOT_FOUND,
    "RESOURCE_NOT_FOUND",
    `The draft has no entity ${entityKey}`,
  );
}

function refuse(code: string, message: string): never {
  throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
}

/** What this draft has had uploaded into it, by entity. */
function uploadedAssetTypes(assets: DraftAsset[]): Map<string, Set<AssetType>> {
  const byKey = new Map<string, Set<AssetType>>();
  for (const asset of assets) {
    const types = byKey.get(asset.entityContentKey) ?? new Set<AssetType>();
    types.add(asset.assetType);
    byKey.set(asset.entityContentKey, types);
  }
  return byKey;
}

/** A DATE column carries no time of day, so neither does the API. */
function isoDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

/** The locales an uploaded drawing already has a display name in. */
function namedLocales(asset: DraftAsset | undefined): string[] {
  if (asset === undefined || asset.localizations === null) {
    return [];
  }
  const localizations = asset.localizations as Record<
    string,
    { displayName?: unknown } | null
  >;
  return Object.entries(localizations)
    .filter(
      ([, value]) =>
        typeof value?.displayName === "string" &&
        value.displayName.trim().length > 0,
    )
    .map(([locale]) => locale);
}

/**
 * The templates an empty slot would unlock for this kind of entity.
 *
 * A coat of arms is a country's, not a state's, so the answer depends on
 * both the symbol and the subject: telling an editor that uploading a coat
 * for California unlocks a card would be telling them to do useless work.
 */
function templatesNeeding(assetType: AssetType, entityType: string): string[] {
  return Object.entries(CARD_TEMPLATES)
    .filter(
      ([, template]) =>
        template.promptAssetType === assetType &&
        template.subjectTypes.includes(entityType),
    )
    .map(([code]) => code)
    .sort();
}

/** Whether a row survives the list filters. */
function matchesEntityFilter(
  row: EntityListItem,
  filter: EntityListFilter,
): boolean {
  if (filter.search !== undefined) {
    // Searched over what a human can see on the row: the key, the identifier
    // codes and the published name. Nothing else on the row is a name.
    const needle = filter.search.toLowerCase();
    const haystack = [
      row.key,
      row.publishedName ?? "",
      ...Object.values(row.identifiers),
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(needle)) {
      return false;
    }
  }
  if (filter.type !== undefined && row.type !== filter.type) {
    return false;
  }
  if (filter.parentKey !== undefined && row.parentKey !== filter.parentKey) {
    return false;
  }
  if (filter.status !== undefined && row.status !== filter.status) {
    return false;
  }
  if (
    filter.includeInCountryCatalog !== undefined &&
    row.includeInCountryCatalog !== filter.includeInCountryCatalog
  ) {
    return false;
  }
  if (filter.missingFlag === true && row.hasFlag) {
    return false;
  }
  if (filter.missingCoatOfArms === true && row.hasCoatOfArms) {
    return false;
  }
  if (filter.missingLocalization === true && row.locales.complete) {
    return false;
  }
  if (filter.usedInDecks !== undefined) {
    if (filter.usedInDecks !== row.usedInDeckCount > 0) {
      return false;
    }
  }
  switch (filter.validation) {
    case "blocking":
      return row.blockingCount > 0;
    case "warning":
      return row.warningCount > 0;
    case "ok":
      return row.blockingCount === 0 && row.warningCount === 0;
    default:
      return true;
  }
}

@Injectable()
export class DraftEntitiesService {
  constructor(
    private readonly database: PrismaService,
    private readonly drafts: AdminDraftsService,
    private readonly readModel: DraftReadModelService,
  ) {}

  /**
   * The entity list as the console renders it, filtered on the server.
   *
   * Every column the list draws — the symbols, the locales, the decks, the
   * validation state — is answered here rather than by a request per row
   * (#356). The filters run over the same in-memory projection, so "missing
   * coats under the United States" costs no more than the plain list does.
   */
  async list(
    draftId: string,
    filter: EntityListFilter,
  ): Promise<EntityListPage> {
    const context = await this.readModel.context(draftId);
    const keys = context.catalog.entities.map((entity) => entity.key);
    const delivery = await this.readModel.entityDelivery(keys, context.reach);
    const uploaded = uploadedAssetTypes(context.draftAssets);
    const findings = new Map<string, ValidationFinding[]>();
    for (const finding of context.report.findings) {
      findings.set(finding.subject, [
        ...(findings.get(finding.subject) ?? []),
        finding,
      ]);
    }

    const rows = context.catalog.entities.map((entry) => {
      const entity = entry as EditorialEntityRecord;
      const published = context.published.get(entity.key);
      const drawn = new Set([
        ...(published?.assetTypes ?? []),
        ...(uploaded.get(entity.key) ?? []),
      ]);
      const counts = DraftReadModelService.counts(
        findings.get(entity.key) ?? [],
      );
      const usages = context.reach.usageByEntity.get(entity.key) ?? [];
      return {
        key: entity.key,
        type: entity.type,
        status: entity.status,
        includeInCountryCatalog: entity.config.includeInCountryCatalog,
        recognitionStatus: entity.recognitionStatus,
        identifiers: entity.identifiers ?? {},
        parentKey: entity.parentKey ?? null,
        hasFlag: drawn.has(AssetType.FLAG),
        hasCoatOfArms: drawn.has(AssetType.COAT_OF_ARMS),
        overrideCount: Object.keys(entity.overrides ?? {}).length,
        // English first for a stable list; any primary name beats none.
        publishedName:
          published?.names.get("en") ??
          [...(published?.names.values() ?? [])][0] ??
          null,
        locales: this.readModel.entityLocales(
          entity,
          context.catalog.supportedLocales,
          published,
        ),
        usedInDeckCount: new Set(usages.map((usage) => usage.deckKey)).size,
        delivery: delivery.get(entity.key) ?? "PUBLIC",
        blockingCount: counts.blocking,
        warningCount: counts.warnings,
      };
    });

    const matched = rows.filter((row) => matchesEntityFilter(row, filter));
    return {
      items: matched.slice(filter.offset, filter.offset + filter.limit),
      total: matched.length,
      draftRevision: context.draft.revision,
    };
  }

  /**
   * One entity with everything its editor needs: the record, the media
   * slots, who teaches it, what a release would deliver it as, and the
   * findings that point at its own fields.
   */
  async getOne(draftId: string, entityKey: string): Promise<EntityDetail> {
    const context = await this.readModel.context(draftId);
    const entity = context.catalog.entities.find(
      (entry) => entry.key === entityKey,
    ) as EditorialEntityRecord | undefined;
    if (entity === undefined) {
      entityNotFound(entityKey);
    }
    const published = context.published.get(entityKey);
    const [delivery, slots, usages] = await Promise.all([
      this.readModel.entityDelivery([entityKey], context.reach),
      this.assetSlots(entity, context),
      this.usages(entityKey, context),
    ]);
    const findings = context.report.findings.filter(
      (finding) => finding.subject === entityKey,
    );
    return {
      entity: toApiEntity(entity),
      publishedNames: Object.fromEntries(published?.names ?? []),
      draftRevision: context.draft.revision,
      delivery: delivery.get(entityKey) ?? "PUBLIC",
      locales: this.readModel.entityLocales(
        entity,
        context.catalog.supportedLocales,
        published,
      ),
      assets: slots,
      usages,
      validation: { ...DraftReadModelService.counts(findings), findings },
    };
  }

  /**
   * The media editor's slots: one per symbol type, filled or not.
   *
   * A draft upload wins over the published drawing because it is what the
   * next release will carry; a slot the release fills and the draft has not
   * touched still shows as filled, so the editor is not invited to upload a
   * flag the catalog already has.
   */
  private async assetSlots(
    entity: EditorialEntityRecord,
    context: DraftContext,
  ): Promise<EntityAssetSlot[]> {
    const uploads = new Map(
      context.draftAssets
        .filter((asset) => asset.entityContentKey === entity.key)
        .map((asset) => [asset.assetType, asset]),
    );
    const publishedTypes =
      context.published.get(entity.key)?.assetTypes ?? new Set<AssetType>();
    const slotDelivery = await this.readModel.assetSlotDelivery(
      ASSET_SLOTS.map((assetType) =>
        this.readModel.slotKey(entity.key, assetType),
      ),
      context.reach,
    );
    const usages = context.reach.usageByEntity.get(entity.key) ?? [];

    return ASSET_SLOTS.map((assetType) => {
      const upload = uploads.get(assetType);
      const state: EntityAssetSlot["state"] =
        upload !== undefined
          ? "draft"
          : publishedTypes.has(assetType)
            ? "published"
            : "empty";
      const prompting = usages.filter(
        (usage) => usage.assetType?.toUpperCase() === assetType,
      );
      return {
        assetType,
        state,
        delivery:
          state === "empty"
            ? null
            : (slotDelivery.get(
                this.readModel.slotKey(entity.key, assetType),
              ) ?? "PAID_ONLY"),
        draftAssetId: upload?.id ?? null,
        variant: upload?.variant ?? null,
        mimeType: upload?.mimeType ?? null,
        width: upload?.width ?? null,
        height: upload?.height ?? null,
        aspectRatio: upload?.aspectRatio?.toNumber() ?? null,
        sourceUrl: upload?.sourceUrl ?? null,
        licenseName: upload?.licenseName ?? null,
        licenseUrl: upload?.licenseUrl ?? null,
        attribution: upload?.attribution ?? null,
        replacementReason: upload?.replacementReason ?? null,
        provenanceComplete:
          upload === undefined
            ? state === "published"
            : upload.licenseName !== null &&
              upload.sourceUrl !== null &&
              upload.replacementReason !== null,
        processing: upload === undefined ? null : processingStateOf(upload),
        validFrom: isoDate(upload?.validFrom ?? null),
        validTo: isoDate(upload?.validTo ?? null),
        retired: upload?.validTo !== undefined && upload.validTo !== null,
        localizations: localeCompleteness(
          context.catalog.supportedLocales,
          namedLocales(upload),
        ),
        usedByCardIds: prompting.map((usage) => usage.cardId),
        usedByDeckKeys: [...new Set(prompting.map((usage) => usage.deckKey))],
        unlocksTemplates: templatesNeeding(assetType, entity.type),
      };
    });
  }

  /** The decks and cards that teach this entity, with what each delivers. */
  private async usages(
    entityKey: string,
    context: DraftContext,
  ): Promise<EntityDeckUsage[]> {
    const usages = this.readModel.usagesOf(context.reach, entityKey);
    const delivery = await this.readModel.cardDelivery(
      usages.map((usage) => usage.cardId),
      context.reach,
    );
    const names = new Map(
      context.catalog.decks.map((deck) => [
        deck.key,
        deck.names.en?.name ?? Object.values(deck.names)[0]?.name ?? null,
      ]),
    );
    return usages.map((usage) => ({
      deckKey: usage.deckKey,
      deckName: names.get(usage.deckKey) ?? null,
      accessModel: usage.accessModel,
      cardId: usage.cardId,
      templateCode: usage.templateCode,
      templateSchemaVersion: usage.templateSchemaVersion,
      assetType: usage.assetType,
      isPreview: usage.isPreview,
      delivery: delivery.get(usage.cardId) ?? "PAID_ONLY",
    }));
  }

  /**
   * Replace-what-you-send: each field in the update replaces the entity's
   * field outright, and `identifiers`/`overrides` replace as whole maps —
   * the form always sends the complete map, so "remove an override" is
   * sending the map without it. An empty map removes the field, because the
   * schema forbids an empty `overrides` rather than treating it as none.
   *
   * `facts` replaces as a whole too, but it lives inside the override map
   * under `facts.*` paths, so the two halves are recombined rather than
   * overwriting one another: sending overrides without facts keeps the
   * facts, and sending facts without overrides keeps the rest.
   */
  async update(
    actor: AdminUser,
    draftId: string,
    expectedRevision: number,
    entityKey: string,
    changes: EntityUpdate,
    requestId: string,
  ): Promise<ContentDraft> {
    return this.drafts.applyDocumentChange(
      actor,
      draftId,
      expectedRevision,
      (current) => {
        const catalog = asCatalog(current);
        const index = catalog.entities.findIndex(
          (entry) => entry.key === entityKey,
        );
        if (index === -1) {
          entityNotFound(entityKey);
        }
        const existing = catalog.entities[index] as EditorialEntityRecord;
        const next = this.merged(existing, changes, entityKey);
        this.assertAdministrativeShape(next, catalog.entities);
        const entities = [...catalog.entities];
        entities[index] = next;
        const document = { ...catalog, entities };
        // v2 has neither the type nor the field, so a document that now
        // carries an administrative parent is written in v3 from here on.
        return next.type === "subdivision" || next.parentKey !== undefined
          ? liftEditorialDocumentToV3(document)
          : document;
      },
      {
        action: "admin.draft.entity_updated",
        metadata: { entityKey, fields: Object.keys(changes) },
      },
      requestId,
    );
  }

  /** The record the update leaves behind, before it is judged. */
  private merged(
    existing: EditorialEntityRecord,
    changes: EntityUpdate,
    entityKey: string,
  ): EditorialEntityRecord {
    // The API fields are flat; in the document the toggle lives in the
    // entity's config object (ADR-015) and the facts live in the overrides.
    const { includeInCountryCatalog, parentKey, facts, ...fieldChanges } =
      changes;
    const stored = splitOverrides(existing.overrides);
    const nextOverrides = {
      ...(changes.overrides === undefined
        ? stored.rest
        : splitOverrides(changes.overrides).rest),
      ...(facts === undefined ? stored.facts : factsToOverrides(facts)),
    };
    const next = {
      ...existing,
      ...fieldChanges,
      overrides: nextOverrides,
      ...(includeInCountryCatalog === undefined
        ? {}
        : { config: { ...existing.config, includeInCountryCatalog } }),
      ...(parentKey === undefined ? {} : { parentKey: parentKey ?? undefined }),
      key: entityKey,
    } as EditorialEntityRecord;
    if (next.type === "subdivision") {
      if (includeInCountryCatalog === true) {
        refuse(
          "SUBDIVISION_IN_COUNTRY_CATALOG",
          `A subdivision never joins the country catalog; ${entityKey} is a state, not a country`,
        );
      }
      // Both are invariants of what a subdivision is rather than choices an
      // editor makes (ADR-020): a state never joins the country catalog, and
      // recognition is a question about states, not about their parts. An
      // editor who only changed the type gets the record the type implies,
      // and one who asked for the opposite was refused just above.
      next.config = { ...next.config, includeInCountryCatalog: false };
      next.recognitionStatus = SUBDIVISION_RECOGNITION_STATUS;
    }
    for (const field of [
      "identifiers",
      "overrides",
      "recognitionAsOf",
      "validFrom",
      "validTo",
      "parentKey",
    ] as const) {
      const value = next[field];
      if (
        value === undefined ||
        value === null ||
        (typeof value === "object" && Object.keys(value).length === 0)
      ) {
        delete next[field];
      }
    }
    return next;
  }

  /**
   * A subdivision has a parent and nothing else does.
   *
   * The publish gate says the same thing over the whole document; this says
   * it where the mistake is made, so the editor is told which field is
   * wrong instead of watching a release refuse to start.
   */
  private assertAdministrativeShape(
    entity: EditorialEntityRecord,
    entities: EditorialEntityRecord[],
  ): void {
    if (entity.type !== "subdivision") {
      if (entity.parentKey !== undefined) {
        refuse(
          "ENTITY_PARENT_NOT_APPLICABLE",
          `Only a subdivision has an administrative parent; ${entity.key} is a ${entity.type}`,
        );
      }
      if (!PARENT_TYPES.includes(entity.type)) {
        // One dropdown must not orphan fifty states: a country that units
        // hang from cannot quietly stop being a country.
        const children = entities.filter(
          (entry) => entry.key !== entity.key && entry.parentKey === entity.key,
        );
        if (children.length > 0) {
          refuse(
            "SUBDIVISION_PARENT_INVALID",
            `${entity.key} is the parent of ${String(children.length)} subdivision(s), so it cannot become a ${entity.type}`,
          );
        }
      }
      return;
    }
    const parentKey = entity.parentKey;
    if (parentKey === undefined) {
      refuse(
        "SUBDIVISION_PARENT_REQUIRED",
        `The subdivision ${entity.key} needs the country or territory it belongs to`,
      );
    }
    if (parentKey === entity.key) {
      refuse(
        "SUBDIVISION_PARENT_INVALID",
        `The subdivision ${entity.key} cannot be its own parent`,
      );
    }
    const parent = entities.find((entry) => entry.key === parentKey);
    if (parent === undefined) {
      refuse(
        "SUBDIVISION_PARENT_INVALID",
        `The draft has no entity ${parentKey} to be the parent of ${entity.key}`,
      );
    }
    if (!PARENT_TYPES.includes(parent.type)) {
      refuse(
        "SUBDIVISION_PARENT_INVALID",
        `A subdivision belongs to a country or a territory; ${parentKey} is a ${parent.type}`,
      );
    }
  }
}
