-- Publish and rollback as recorded runs (ADR-017).
--
-- Applying a release is a Serializable transaction with a twenty-minute
-- timeout, which no HTTP request survives. The console asks for a run and
-- watches it — the same shape as watching a workflow, with our own executor
-- — so the work needs a row of its own to be watched through.

CREATE TYPE "public"."PublishRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

CREATE TYPE "public"."PublishRunKind" AS ENUM ('PUBLISH', 'ROLLBACK');

CREATE TABLE "public"."publish_runs" (
  "id" UUID NOT NULL,
  "kind" "public"."PublishRunKind" NOT NULL,
  "status" "public"."PublishRunStatus" NOT NULL DEFAULT 'QUEUED',
  "content_version" TEXT NOT NULL,
  "minimum_client_version" TEXT,
  "previous_version" TEXT,
  "stage" TEXT,
  "failure_code" TEXT,
  "failure_message" TEXT,
  "execution_name" TEXT,
  "requested_by_admin_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(3),
  "finished_at" TIMESTAMPTZ(3),

  CONSTRAINT "publish_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "publish_runs_status_created_at_idx" ON "public"."publish_runs"("status", "created_at");

-- One run at a time, enforced by the database rather than by a workflow's
-- `concurrency` (ADR-017 §4). That guard only covered a second run of the
-- same workflow; this covers every way a run can start, including the CLI.
-- A second request is refused at the door instead of waiting twenty minutes
-- to lose a race over the active pointer.
CREATE UNIQUE INDEX "publish_runs_single_active_idx"
  ON "public"."publish_runs"((TRUE))
  WHERE "status" IN ('QUEUED', 'RUNNING');

ALTER TABLE "public"."publish_runs"
  ADD CONSTRAINT "publish_runs_requested_by_admin_user_id_fkey"
  FOREIGN KEY ("requested_by_admin_user_id")
  REFERENCES "public"."admin_users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
