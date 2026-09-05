import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Ajv2020 from "ajv/dist/2020";
import type { ValidateFunction } from "ajv";

import { ApiException } from "../../common/http/api.exception";
import type { EnvironmentVariables } from "../../config/environment.validation";

export interface EditorialDocument extends Record<string, unknown> {
  schemaVersion: number;
}

/**
 * The newest version the console can write. A document is lifted into it
 * only where an edit needs what it added (ADR-020: administrative parents
 * and typed assets); everything else keeps the version it arrived in.
 */
export const EDITORIAL_SCHEMA_VERSION = 3;

/**
 * Drafts saved before ADR-015 carry schema v1, where the listing toggle
 * sat flat on the entity. JSONB keeps whatever shape was stored, so old
 * drafts are lifted to v2 on read instead of by a data migration — the
 * next write persists the lifted shape through the schema check.
 */
export function normalizeEditorialDocument(
  document: Record<string, unknown>,
): Record<string, unknown> {
  if (document.schemaVersion !== 1) {
    return document;
  }
  const entities = Array.isArray(document.entities) ? document.entities : [];
  return {
    ...document,
    schemaVersion: 2,
    entities: entities.map((entry) => {
      const entity = entry as Record<string, unknown>;
      const { includeInCountryCatalog, ...rest } = entity;
      return {
        ...rest,
        config: {
          includeInCountryCatalog: includeInCountryCatalog === true,
        },
      };
    }),
  };
}

/** What a v2 deck taught: a flag, asked as the country it belongs to. */
const DEFAULT_TEMPLATE_CODE = "FLAG_TO_COUNTRY";
const DEFAULT_TEMPLATE_SCHEMA_VERSION = 1;
/** The drawing in force, as opposed to a historical or ceremonial one. */
const DEFAULT_ASSET_VARIANT = "current";

/**
 * Lifts a v2 document to v3, the way the pipeline already lifts one on read
 * (`tools/content-pipeline/src/adapters.ts`).
 *
 * v2 cannot express a subdivision at all: its entity has no `parentKey` and
 * its type enum has no `subdivision`. So a draft moves to v3 the moment an
 * edit needs v3 to say what it means, and not before — a catalog of nothing
 * but countries stays in the version it was written in, which is what the
 * console, the proposal and the pipeline all still read.
 *
 * The lift is one-way and mechanical: every deck the old document held
 * taught a flag, and every override replaced the current drawing.
 */
export function liftEditorialDocumentToV3(
  document: Record<string, unknown>,
): Record<string, unknown> {
  if (document.schemaVersion === EDITORIAL_SCHEMA_VERSION) {
    return document;
  }
  const decks = Array.isArray(document.decks) ? document.decks : [];
  const overrides = Array.isArray(document.assetOverrides)
    ? document.assetOverrides
    : undefined;
  return {
    ...document,
    schemaVersion: EDITORIAL_SCHEMA_VERSION,
    decks: decks.map((deck) => ({
      defaultTemplateCode: DEFAULT_TEMPLATE_CODE,
      defaultTemplateSchemaVersion: DEFAULT_TEMPLATE_SCHEMA_VERSION,
      ...(deck as Record<string, unknown>),
    })),
    ...(overrides === undefined
      ? {}
      : {
          assetOverrides: overrides.map((override) => ({
            variant: DEFAULT_ASSET_VARIANT,
            ...(override as Record<string, unknown>),
          })),
        }),
  };
}

/**
 * The versioned JSON Schema is the boundary: a draft document that does not
 * conform is refused, never stored. The schema itself lives in contracts/
 * (single source of truth, validated against the real catalog by
 * contracts:check) and is delivered to the runtime as a file.
 *
 * Two versions are readable at once because a draft is lifted where it is
 * edited rather than by a migration: the document says which version it is
 * written in, and that decides which schema judges it.
 */
@Injectable()
export class EditorialDocumentService {
  private readonly compiledByVersion = new Map<number, ValidateFunction>();

  constructor(private readonly config: ConfigService<EnvironmentVariables>) {}

  assertValid(document: unknown): EditorialDocument {
    const declared = (document as { schemaVersion?: unknown } | null)
      ?.schemaVersion;
    const validate = this.compiled(
      declared === EDITORIAL_SCHEMA_VERSION ? EDITORIAL_SCHEMA_VERSION : 2,
    );
    if (!validate(document)) {
      const details = (validate.errors ?? []).slice(0, 20).map((error) => ({
        path: error.instancePath === "" ? "/" : error.instancePath,
        message: error.message ?? "is invalid",
      }));
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "DRAFT_DOCUMENT_INVALID",
        "The draft document does not conform to the editorial catalog schema",
        { errors: details },
      );
    }
    return document as EditorialDocument;
  }

  private compiled(version: number): ValidateFunction {
    const cached = this.compiledByVersion.get(version);
    if (cached !== undefined) {
      return cached;
    }
    const schemaPath = resolve(
      process.cwd(),
      this.config.getOrThrow<string>(
        version === EDITORIAL_SCHEMA_VERSION
          ? "ADMIN_EDITORIAL_SCHEMA_V3_PATH"
          : "ADMIN_EDITORIAL_SCHEMA_PATH",
      ),
    );
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(schema);
    this.compiledByVersion.set(version, validate);
    return validate;
  }
}
