ALTER TABLE "public"."guest_import_operations"
  ADD COLUMN "request_hash" CHAR(64);

UPDATE "public"."guest_import_operations"
SET "request_hash" = repeat('0', 64)
WHERE "request_hash" IS NULL;

ALTER TABLE "public"."guest_import_operations"
  ALTER COLUMN "request_hash" SET NOT NULL,
  ADD CONSTRAINT "guest_import_request_hash_check"
    CHECK ("request_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "public"."data_export_requests"
  ADD COLUMN "payload_text" TEXT,
  ADD COLUMN "download_token_hash" CHAR(64);

CREATE UNIQUE INDEX "data_export_requests_download_token_hash_key"
  ON "public"."data_export_requests"("download_token_hash");

ALTER TABLE "public"."data_export_requests"
  ADD CONSTRAINT "data_export_download_token_hash_check"
    CHECK (
      "download_token_hash" IS NULL
      OR "download_token_hash" ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT "data_export_ready_payload_check"
    CHECK (
      "status" <> 'READY'
      OR (
        "payload_text" IS NOT NULL
        AND "download_token_hash" IS NOT NULL
        AND "object_key" IS NOT NULL
        AND "sha256" IS NOT NULL
        AND "expires_at" IS NOT NULL
      )
    );
