-- The asset stops describing an encoding of its own.
--
-- Every published encoding lives in `asset_representations`, including the
-- vector these three columns described. They were kept for one release so a
-- client written before the list existed kept working — and no such client was
-- ever released, so the release they were waiting for is this one.
--
-- Nothing reads them: both serialisation sites now build an `Asset` document
-- from the representation rows, and the publisher stopped writing them.
-- The index went with the column it was on: nothing looks an asset up by the
-- checksum of an encoding it no longer describes.
DROP INDEX IF EXISTS "public"."assets_sha256_idx";

ALTER TABLE "public"."assets"
  DROP COLUMN "public_url",
  DROP COLUMN "mime_type",
  DROP COLUMN "sha256";
