ALTER TABLE "public"."study_sessions"
  ADD COLUMN "request_hash" CHAR(64) NOT NULL DEFAULT repeat('0', 64);

ALTER TABLE "public"."study_sessions"
  ALTER COLUMN "request_hash" DROP DEFAULT,
  ADD CONSTRAINT "study_sessions_request_hash_check"
    CHECK ("request_hash" ~ '^[a-f0-9]{64}$');
