-- Access-management audit trail: who granted, changed or revoked admin
-- access, with a compact before/after diff in metadata. Actor is SET NULL on
-- delete so history survives the account it describes.

CREATE TABLE "public"."admin_audit_events" (
  "id" UUID NOT NULL,
  "actor_admin_user_id" UUID,
  "action" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT,
  "request_id" UUID,
  "metadata" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_events_target_type_target_id_occurred_at_idx"
  ON "public"."admin_audit_events"("target_type", "target_id", "occurred_at");

CREATE INDEX "admin_audit_events_actor_admin_user_id_occurred_at_idx"
  ON "public"."admin_audit_events"("actor_admin_user_id", "occurred_at");

ALTER TABLE "public"."admin_audit_events"
  ADD CONSTRAINT "admin_audit_events_actor_admin_user_id_fkey"
  FOREIGN KEY ("actor_admin_user_id") REFERENCES "public"."admin_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
