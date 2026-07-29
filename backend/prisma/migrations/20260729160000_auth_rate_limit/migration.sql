-- CreateTable
CREATE TABLE "public"."auth_rate_limit_buckets" (
    "key_hash" CHAR(64) NOT NULL,
    "scope" TEXT NOT NULL,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_rate_limit_buckets_pkey" PRIMARY KEY ("key_hash")
);

-- CreateIndex
CREATE INDEX "auth_rate_limit_buckets_scope_window_started_at_idx"
ON "public"."auth_rate_limit_buckets"("scope", "window_started_at");

-- Keep persisted counters structurally valid.
ALTER TABLE "public"."auth_rate_limit_buckets"
ADD CONSTRAINT "auth_rate_limit_buckets_request_count_check"
CHECK ("request_count" >= 0);
