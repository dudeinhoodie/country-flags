CREATE TYPE "public"."ReconciliationJobStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED'
);

CREATE TYPE "public"."UserChangeOperation" AS ENUM ('UPSERT', 'TOMBSTONE');
CREATE TYPE "public"."UserChangeResourceType" AS ENUM ('CARD_STATE');

ALTER TABLE "public"."scheduler_migration_checkpoints"
  ADD COLUMN "reconciliation_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_reconciled_at" TIMESTAMPTZ(3);

ALTER TABLE "public"."users"
  ADD COLUMN "sync_stream_id" UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE "public"."learning_outbox"
  ADD COLUMN "lease_token" UUID,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_error_code" TEXT;

DROP INDEX "public"."learning_outbox_delivery_status_next_attempt_at_idx";
CREATE INDEX "learning_outbox_delivery_status_next_attempt_at_lease_expires_at_idx"
  ON "public"."learning_outbox"(
    "delivery_status", "next_attempt_at", "lease_expires_at"
  );

CREATE TABLE "public"."user_changes" (
  "sequence" BIGSERIAL NOT NULL,
  "user_id" UUID NOT NULL,
  "operation" "public"."UserChangeOperation" NOT NULL,
  "resource_type" "public"."UserChangeResourceType" NOT NULL,
  "resource_id" UUID NOT NULL,
  "source_operation_id" UUID NOT NULL,
  "payload" JSONB,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_changes_pkey" PRIMARY KEY ("sequence")
);

CREATE UNIQUE INDEX "user_changes_user_id_source_operation_id_resource_type_operation_key"
  ON "public"."user_changes"(
    "user_id", "source_operation_id", "resource_type", "operation"
  );

CREATE INDEX "user_changes_user_id_sequence_idx"
  ON "public"."user_changes"("user_id", "sequence");

ALTER TABLE "public"."user_changes"
  ADD CONSTRAINT "user_changes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."user_changes"
  ADD CONSTRAINT "user_changes_payload_shape_check"
  CHECK (
    ("operation" = 'UPSERT' AND "payload" IS NOT NULL) OR
    ("operation" = 'TOMBSTONE' AND "payload" IS NULL)
  );

CREATE TRIGGER "user_changes_immutable"
  BEFORE UPDATE ON "public"."user_changes"
  FOR EACH ROW EXECUTE FUNCTION "public"."reject_immutable_row_update"();

INSERT INTO "public"."user_changes" (
  "user_id",
  "operation",
  "resource_type",
  "resource_id",
  "source_operation_id",
  "payload",
  "occurred_at"
)
SELECT
  state."user_id",
  'UPSERT'::"public"."UserChangeOperation",
  'CARD_STATE'::"public"."UserChangeResourceType",
  state."learning_card_id",
  gen_random_uuid(),
  jsonb_build_object(
    'learningCardId', state."learning_card_id",
    'state', state."state",
    'difficulty', state."difficulty"::double precision,
    'stability', state."stability"::double precision,
    'dueAt', state."due_at",
    'repetitions', state."repetitions",
    'lapses', state."lapses",
    'schedulerVersion', state."scheduler_version",
    'schedulerParametersVersion', state."scheduler_parameters_version",
    'stateVersion', state."state_version",
    'updatedAt', state."updated_at"
  ),
  state."updated_at"
FROM "public"."user_card_states" AS state;

CREATE TABLE "public"."reconciliation_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "learning_card_id" UUID NOT NULL,
  "target_scheduler_version" TEXT NOT NULL,
  "status" "public"."ReconciliationJobStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ(3),
  "last_error_code" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  "dead_lettered_at" TIMESTAMPTZ(3),

  CONSTRAINT "reconciliation_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reconciliation_jobs_active_card_target_key"
  ON "public"."reconciliation_jobs"(
    "user_id", "learning_card_id", "target_scheduler_version"
  )
  WHERE "status" IN ('PENDING', 'PROCESSING');

CREATE INDEX "reconciliation_jobs_status_available_at_lease_expires_at_created_at_idx"
  ON "public"."reconciliation_jobs"(
    "status", "available_at", "lease_expires_at", "created_at"
  );

ALTER TABLE "public"."reconciliation_jobs"
  ADD CONSTRAINT "reconciliation_jobs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."reconciliation_jobs"
  ADD CONSTRAINT "reconciliation_jobs_learning_card_id_fkey"
  FOREIGN KEY ("learning_card_id") REFERENCES "public"."learning_cards"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "public"."scheduler_migration_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "target_scheduler_version" TEXT NOT NULL,
  "status" "public"."ReconciliationJobStatus" NOT NULL DEFAULT 'PENDING',
  "after_user_id" UUID,
  "after_learning_card_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),

  CONSTRAINT "scheduler_migration_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scheduler_migration_runs_target_scheduler_version_key"
  ON "public"."scheduler_migration_runs"("target_scheduler_version");
CREATE INDEX "scheduler_migration_runs_status_updated_at_idx"
  ON "public"."scheduler_migration_runs"("status", "updated_at");

ALTER TABLE "public"."scheduler_migration_runs"
  ADD CONSTRAINT "scheduler_migration_runs_target_scheduler_version_fkey"
  FOREIGN KEY ("target_scheduler_version")
  REFERENCES "public"."scheduler_definitions"("version")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."scheduler_migration_runs"
  ADD CONSTRAINT "scheduler_migration_runs_cursor_check" CHECK (
    ("after_user_id" IS NULL AND "after_learning_card_id" IS NULL)
    OR ("after_user_id" IS NOT NULL AND "after_learning_card_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "scheduler_migration_runs_completion_check" CHECK (
    ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL)
    OR ("status" <> 'COMPLETED' AND "completed_at" IS NULL)
  );

ALTER TABLE "public"."reconciliation_jobs"
  ADD CONSTRAINT "reconciliation_jobs_attempt_count_check"
    CHECK ("attempt_count" >= 0),
  ADD CONSTRAINT "reconciliation_jobs_lease_check" CHECK (
    ("status" = 'PROCESSING' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    OR ("status" <> 'PROCESSING' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)
  ),
  ADD CONSTRAINT "reconciliation_jobs_completion_check" CHECK (
    ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL)
    OR ("status" <> 'COMPLETED' AND "completed_at" IS NULL)
  ),
  ADD CONSTRAINT "reconciliation_jobs_dead_letter_check" CHECK (
    ("status" = 'FAILED' AND "dead_lettered_at" IS NOT NULL)
    OR ("status" <> 'FAILED' AND "dead_lettered_at" IS NULL)
  );

ALTER TABLE "public"."reconciliation_jobs"
  ADD CONSTRAINT "reconciliation_jobs_target_scheduler_version_fkey"
  FOREIGN KEY ("target_scheduler_version")
  REFERENCES "public"."scheduler_definitions"("version")
  ON DELETE RESTRICT ON UPDATE CASCADE;
