-- A read-only store sync as a recorded run (17-paid-decks-storekit §12.4).
--
-- The console does not talk to App Store Connect: the API key lives in Secret
-- Manager and belongs to a job, not to a browser session. So asking for a
-- sync writes a row and returns, and the run is watched the same way a
-- publish run is. Nothing this table describes creates an in-app purchase or
-- changes a price.

CREATE TYPE "public"."StoreSyncRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "public"."store_sync_runs" (
  "id" UUID NOT NULL,
  "provider" "public"."StoreProvider" NOT NULL DEFAULT 'APPLE_APP_STORE',
  "store_environment" "public"."StoreEnvironment" NOT NULL,
  "status" "public"."StoreSyncRunStatus" NOT NULL DEFAULT 'QUEUED',
  "checked_product_count" INTEGER,
  "failure_message" TEXT,
  "requested_by_admin_user_id" UUID NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),

  CONSTRAINT "store_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "store_sync_runs_environment_started_at_idx"
  ON "public"."store_sync_runs"("store_environment", "started_at");

-- One sync at a time per store, enforced here rather than by whoever clicks.
-- Two concurrent runs would write the same products' validation state from
-- two answers, and the later one would not be the newer one.
CREATE UNIQUE INDEX "store_sync_runs_single_active_idx"
  ON "public"."store_sync_runs"("provider", "store_environment")
  WHERE "status" IN ('QUEUED', 'RUNNING');

ALTER TABLE "public"."store_sync_runs"
  ADD CONSTRAINT "store_sync_runs_requested_by_admin_user_id_fkey"
  FOREIGN KEY ("requested_by_admin_user_id")
  REFERENCES "public"."admin_users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
