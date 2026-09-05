import { HttpStatus, Injectable } from "@nestjs/common";
import { AssetStatus, AssetType } from "@prisma/client";
import type { AdminUser, ContentDraft } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminDraftsService } from "./admin-drafts.service";
import { liftEditorialDocumentToV3 } from "./editorial-document.service";

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
 * Reads the typed facts back out of the override map.
 *
 * The editorial schema has no `facts` object on an entity: the layer that
 * carries hand-made values is `overrides`, whose dotted paths are applied
 * with the pipeline's highest priority. So a curator's capital is the
 * override `facts.capital.en`, and this projection is what turns the map
 * the document stores into the shape the console edits.
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
    const [field, locale] = segments;
    if (field === undefined || segments.length > 2) {
      continue;
    }
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
      overrides[`${FACT_PREFIX}${field}`] = measured;
    }
  }
  if (facts.statehoodDate !== undefined) {
    overrides[`${FACT_PREFIX}statehoodDate`] = facts.statehoodDate;
  }
  if (facts.languages !== undefined && facts.languages.length > 0) {
    overrides[`${FACT_PREFIX}languages`] = facts.languages;
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
}

export interface EntityDetail {
  entity: ApiEntityRecord;
  /**
   * What the active release currently serves for this entity, locale → short
   * name. Placeholders for the editor: an override the entity does not carry
   * falls back to these at build time.
   */
  publishedNames: Record<string, string>;
}

interface EditorialCatalogDocument extends Record<string, unknown> {
  entities: EditorialEntityRecord[];
}

/** What an entity already has drawn for it, published or uploaded. */
interface PublishedContext {
  name: string | null;
  assetTypes: Set<AssetType>;
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

@Injectable()
export class DraftEntitiesService {
  constructor(
    private readonly database: PrismaService,
    private readonly drafts: AdminDraftsService,
  ) {}

  async list(draftId: string): Promise<EntityListItem[]> {
    const draft = await this.drafts.get(draftId);
    const catalog = asCatalog(draft.document);
    const context = await this.publishedContext(
      catalog.entities.map((entity) => entity.key),
    );
    const uploaded = await this.uploadedAssetTypes(draftId);
    return catalog.entities.map((entity) => {
      const drawn = new Set([
        ...(context.get(entity.key)?.assetTypes ?? []),
        ...(uploaded.get(entity.key) ?? []),
      ]);
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
        publishedName: context.get(entity.key)?.name ?? null,
      };
    });
  }

  async getOne(draftId: string, entityKey: string): Promise<EntityDetail> {
    const draft = await this.drafts.get(draftId);
    const catalog = asCatalog(draft.document);
    const entity = catalog.entities.find((entry) => entry.key === entityKey);
    if (entity === undefined) {
      entityNotFound(entityKey);
    }
    const published = await this.database.geoEntity.findUnique({
      where: { contentKey: entityKey },
      select: {
        names: {
          where: { isPrimary: true, nameType: "SHORT" },
          select: { locale: true, value: true },
        },
      },
    });
    const publishedNames: Record<string, string> = {};
    for (const name of published?.names ?? []) {
      publishedNames[name.locale] = name.value;
    }
    return { entity: toApiEntity(entity), publishedNames };
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

  /** One query for what the active release already knows about these keys. */
  private async publishedContext(
    keys: string[],
  ): Promise<Map<string, PublishedContext>> {
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
    const byKey = new Map<string, PublishedContext>();
    for (const row of rows) {
      // English first for a stable list; any primary name beats none.
      const name =
        row.names.find((entry) => entry.locale === "en") ?? row.names[0];
      byKey.set(row.contentKey, {
        name: name?.value ?? null,
        assetTypes: new Set(row.assets.map((asset) => asset.assetType)),
      });
    }
    return byKey;
  }

  /** And one for what this draft has had uploaded into it. */
  private async uploadedAssetTypes(
    draftId: string,
  ): Promise<Map<string, Set<AssetType>>> {
    const rows = await this.database.draftAsset.findMany({
      where: { draftId },
      select: { entityContentKey: true, assetType: true },
    });
    const byKey = new Map<string, Set<AssetType>>();
    for (const row of rows) {
      const types = byKey.get(row.entityContentKey) ?? new Set<AssetType>();
      types.add(row.assetType);
      byKey.set(row.entityContentKey, types);
    }
    return byKey;
  }
}
