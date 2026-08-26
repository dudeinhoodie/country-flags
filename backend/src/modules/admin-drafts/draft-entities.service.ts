import { HttpStatus, Injectable } from "@nestjs/common";
import type { AdminUser, ContentDraft } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { AdminDraftsService } from "./admin-drafts.service";

/**
 * The editorial record of an entity: the selection and the hand-made
 * corrections, never the merged result. Names and facts come from upstream
 * sources at build time; what an editor owns is whether the entity is in
 * the catalog, how it is coded, and which fields the `overrides` layer
 * pins on purpose (each key a dotted path, e.g. `names.ru.short`).
 */
export interface EditorialEntityRecord extends Record<string, unknown> {
  key: string;
  type: "country" | "territory" | "area" | "region" | "subregion";
  status: "active" | "historical" | "retired" | "hidden";
  /** Presentation toggles (ADR-015); they never gate learnability. */
  config: { includeInCountryCatalog: boolean };
  recognitionStatus: string;
  recognitionAsOf?: string;
  validFrom?: string;
  validTo?: string;
  identifiers?: Record<string, string>;
  overrides?: Record<string, unknown>;
}

/**
 * The API keeps the toggle flat: nesting is document structure, and the
 * console's screens should not have to know where a toggle happens to live
 * in the editorial file.
 */
export type ApiEntityRecord = Omit<EditorialEntityRecord, "config"> & {
  includeInCountryCatalog: boolean;
};

function toApiEntity(entity: EditorialEntityRecord): ApiEntityRecord {
  const { config, ...rest } = entity;
  return { ...rest, includeInCountryCatalog: config.includeInCountryCatalog };
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

@Injectable()
export class DraftEntitiesService {
  constructor(
    private readonly database: PrismaService,
    private readonly drafts: AdminDraftsService,
  ) {}

  async list(draftId: string): Promise<EntityListItem[]> {
    const draft = await this.drafts.get(draftId);
    const catalog = asCatalog(draft.document);
    const publishedNameByKey = await this.publishedShortNames(
      catalog.entities.map((entity) => entity.key),
    );
    return catalog.entities.map((entity) => ({
      key: entity.key,
      type: entity.type,
      status: entity.status,
      includeInCountryCatalog: entity.config.includeInCountryCatalog,
      recognitionStatus: entity.recognitionStatus,
      identifiers: entity.identifiers ?? {},
      overrideCount: Object.keys(entity.overrides ?? {}).length,
      publishedName: publishedNameByKey.get(entity.key) ?? null,
    }));
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
        // The API field is flat; in the document the toggle lives in the
        // entity's config object (ADR-015).
        const { includeInCountryCatalog, ...fieldChanges } = changes;
        const next = {
          ...existing,
          ...fieldChanges,
          ...(includeInCountryCatalog === undefined
            ? {}
            : { config: { ...existing.config, includeInCountryCatalog } }),
          key: entityKey,
        } as EditorialEntityRecord;
        for (const field of [
          "identifiers",
          "overrides",
          "recognitionAsOf",
          "validFrom",
          "validTo",
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
        const entities = [...catalog.entities];
        entities[index] = next;
        return { ...catalog, entities };
      },
      {
        action: "admin.draft.entity_updated",
        metadata: { entityKey, fields: Object.keys(changes) },
      },
      requestId,
    );
  }

  private async publishedShortNames(
    keys: string[],
  ): Promise<Map<string, string>> {
    const rows = await this.database.geoEntity.findMany({
      where: { contentKey: { in: keys } },
      select: {
        contentKey: true,
        names: {
          where: { isPrimary: true, nameType: "SHORT" },
          select: { locale: true, value: true },
        },
      },
    });
    const nameByKey = new Map<string, string>();
    for (const row of rows) {
      // English first for a stable list; any primary name beats none.
      const name =
        row.names.find((entry) => entry.locale === "en") ?? row.names[0];
      if (name !== undefined) {
        nameByKey.set(row.contentKey, name.value);
      }
    }
    return nameByKey;
  }
}
