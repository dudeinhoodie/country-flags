-- Editorial drafts (ADR-014 §6): the catalog's editorial layer becomes a
-- versioned JSONB document in the database. Published content tables stay
-- untouched — a draft leaves the database only as a deterministic export
-- headed for a pull request, and git remains the single merge point.

CREATE TYPE "public"."ContentDraftStatus" AS ENUM ('DRAFT', 'VALIDATING', 'READY', 'PROPOSED', 'MERGED', 'FAILED');

CREATE TYPE "public"."DraftAssetValidationStatus" AS ENUM ('PENDING', 'VALID', 'INVALID');

CREATE TABLE "public"."content_drafts" (
  "id" UUID NOT NULL,
  "base_content_version" TEXT NOT NULL,
  "base_catalog_commit" TEXT NOT NULL,
  "schema_version" INTEGER NOT NULL,
  -- Optimistic concurrency: every write carries the revision it read, and a
  -- stale writer gets 409 instead of silently overwriting a colleague.
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" "public"."ContentDraftStatus" NOT NULL DEFAULT 'DRAFT',
  "document" JSONB NOT NULL,
  "validation_report" JSONB,
  "proposal_url" TEXT,
  "created_by_admin_user_id" UUID NOT NULL,
  "updated_by_admin_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "content_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_drafts_status_updated_at_idx"
  ON "public"."content_drafts"("status", "updated_at");

-- Draft-only asset replacements (uploads land here in ADM-009). Kept apart
-- from the published assets table on purpose: cleanup and access rules for
-- drafts must never be able to touch a published object.
CREATE TABLE "public"."draft_assets" (
  "id" UUID NOT NULL,
  "draft_id" UUID NOT NULL,
  "entity_content_key" TEXT NOT NULL,
  "asset_type" "public"."AssetType" NOT NULL,
  "variant" TEXT NOT NULL,
  "object_key" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "aspect_ratio" DECIMAL(12,6),
  "source_url" TEXT,
  "license_name" TEXT,
  "license_url" TEXT,
  "attribution" TEXT,
  "replacement_reason" TEXT,
  "supersedes_source_key" TEXT,
  "validation_status" "public"."DraftAssetValidationStatus" NOT NULL DEFAULT 'PENDING',
  "validation_errors" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "draft_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "draft_assets_object_key_key"
  ON "public"."draft_assets"("object_key");

CREATE UNIQUE INDEX "draft_assets_draft_id_entity_content_key_asset_type_variant_key"
  ON "public"."draft_assets"("draft_id", "entity_content_key", "asset_type", "variant");

CREATE INDEX "draft_assets_draft_id_idx"
  ON "public"."draft_assets"("draft_id");

ALTER TABLE "public"."content_drafts"
  ADD CONSTRAINT "content_drafts_created_by_admin_user_id_fkey"
  FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."admin_users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."content_drafts"
  ADD CONSTRAINT "content_drafts_updated_by_admin_user_id_fkey"
  FOREIGN KEY ("updated_by_admin_user_id") REFERENCES "public"."admin_users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."draft_assets"
  ADD CONSTRAINT "draft_assets_draft_id_fkey"
  FOREIGN KEY ("draft_id") REFERENCES "public"."content_drafts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
