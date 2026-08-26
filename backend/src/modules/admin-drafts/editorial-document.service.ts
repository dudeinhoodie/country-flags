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

/**
 * The versioned JSON Schema is the boundary: a draft document that does not
 * conform is refused, never stored. The schema itself lives in contracts/
 * (single source of truth, validated against the real catalog by
 * contracts:check) and is delivered to the runtime as a file.
 */
@Injectable()
export class EditorialDocumentService {
  private validateFunction: ValidateFunction | undefined;

  constructor(private readonly config: ConfigService<EnvironmentVariables>) {}

  assertValid(document: unknown): EditorialDocument {
    const validate = this.compiled();
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

  private compiled(): ValidateFunction {
    if (this.validateFunction === undefined) {
      const schemaPath = resolve(
        process.cwd(),
        this.config.getOrThrow<string>("ADMIN_EDITORIAL_SCHEMA_PATH"),
      );
      const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      this.validateFunction = ajv.compile(schema);
    }
    return this.validateFunction;
  }
}
