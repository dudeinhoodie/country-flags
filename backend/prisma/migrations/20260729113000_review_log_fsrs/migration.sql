-- Review ingestion uses a dedicated operational outbox. It is deliberately
-- separate from analytics_outbox so immutable per-card history is not copied
-- into product analytics.
CREATE TABLE "public"."learning_outbox" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source_event_id" UUID NOT NULL,
    "learning_card_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivery_status" "public"."OutboxDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),

    CONSTRAINT "learning_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "learning_outbox_user_id_source_event_id_event_type_key"
  ON "public"."learning_outbox"("user_id", "source_event_id", "event_type");

CREATE INDEX "learning_outbox_delivery_status_next_attempt_at_idx"
  ON "public"."learning_outbox"("delivery_status", "next_attempt_at");

CREATE INDEX "learning_outbox_user_id_learning_card_id_occurred_at_idx"
  ON "public"."learning_outbox"("user_id", "learning_card_id", "occurred_at");

ALTER TABLE "public"."learning_outbox"
  ADD CONSTRAINT "learning_outbox_attempt_count_check" CHECK ("attempt_count" >= 0),
  ADD CONSTRAINT "learning_outbox_delivery_check" CHECK (
    ("delivery_status" = 'DELIVERED' AND "delivered_at" IS NOT NULL)
    OR ("delivery_status" <> 'DELIVERED' AND "delivered_at" IS NULL)
  ),
  ADD CONSTRAINT "learning_outbox_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- The public contract uses zero to mean that the client reviewed a card before
-- it had a persisted projection.
ALTER TABLE "public"."review_events"
  DROP CONSTRAINT "review_events_versions_check",
  ADD CONSTRAINT "review_events_versions_check" CHECK (
    "payload_version" > 0 AND ("base_state_version" IS NULL OR "base_state_version" >= 0)
  );
