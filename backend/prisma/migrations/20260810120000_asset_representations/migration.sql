-- Assets gain a list of published encodings. The vector original stays on the
-- asset row for one release so a client that predates the field keeps working;
-- the raster entries are what iOS can actually decode.
CREATE TABLE "public"."asset_representations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "asset_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "public_url" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  -- Of the bytes this representation serves: a client verifies what it
  -- downloaded, and the checksum of the vector cannot vouch for a raster.
  "sha256" CHAR(64) NOT NULL,
  -- Null for the vector original, which has no fixed screen scale.
  "scale" INTEGER,
  "width_px" INTEGER,
  "height_px" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "asset_representations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "asset_representations_order_unique"
  ON "public"."asset_representations"("asset_id", "sort_order");

CREATE UNIQUE INDEX "asset_representations_url_unique"
  ON "public"."asset_representations"("asset_id", "public_url");

CREATE INDEX "asset_representations_asset_id_idx"
  ON "public"."asset_representations"("asset_id");

ALTER TABLE "public"."asset_representations"
  ADD CONSTRAINT "asset_representations_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Every asset published before this migration served exactly one encoding, and
-- it is the one the asset row already describes. Seeding it keeps the response
-- shape uniform without a republish.
INSERT INTO "public"."asset_representations" (
  "asset_id", "sort_order", "public_url", "mime_type", "sha256"
)
SELECT "id", 0, "public_url", "mime_type", "sha256"
FROM "public"."assets";
