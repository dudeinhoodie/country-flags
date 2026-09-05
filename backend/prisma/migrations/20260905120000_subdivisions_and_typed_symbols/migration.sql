-- Subdivisions and typed symbols (ADR-020).
--
-- A U.S. state keeps a country's names, facts, assets, provenance and
-- publishing lifecycle, so it stays in geo_entities and gets a kind of its
-- own rather than a table of its own. Its parent is a CONTAINS relation
-- under the ADMINISTRATIVE taxonomy, so nothing gains a second way to ask
-- who California belongs to.
--
-- A coat of arms is a second asset of the same entity, not a second entity.
-- That needs the symbol's own name and story per locale, and an identity
-- that stops one symbol from overwriting another.

ALTER TYPE "public"."GeoEntityKind" ADD VALUE 'SUBDIVISION' BEFORE 'REGION';

ALTER TYPE "public"."FactType" ADD VALUE 'STATEHOOD_DATE' BEFORE 'OTHER';
ALTER TYPE "public"."FactType" ADD VALUE 'MOTTO' BEFORE 'OTHER';
ALTER TYPE "public"."FactType" ADD VALUE 'LARGEST_CITY' BEFORE 'OTHER';

CREATE TABLE "public"."asset_localizations" (
  "asset_id" UUID NOT NULL,
  "locale" TEXT NOT NULL,
  "display_name" TEXT,
  "description" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "asset_localizations_pkey" PRIMARY KEY ("asset_id", "locale")
);

CREATE INDEX "asset_localizations_asset_id_idx" ON "public"."asset_localizations" ("asset_id");

ALTER TABLE "public"."asset_localizations"
  ADD CONSTRAINT "asset_localizations_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "public"."assets" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- One drawing per entity, type, variant and period.
--
-- NULLS NOT DISTINCT is the point of the index rather than a detail of it:
-- valid_from is null for the drawing in force, which is nearly every row,
-- and under the default Postgres would call each of those distinct and
-- enforce nothing at all. Entities are per release, so this is uniqueness
-- inside one published catalog.
CREATE UNIQUE INDEX "assets_symbol_identity_unique"
  ON "public"."assets" ("geo_entity_id", "asset_type", "variant", "valid_from")
  NULLS NOT DISTINCT;
