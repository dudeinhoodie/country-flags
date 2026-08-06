-- DropIndex
DROP INDEX "public"."analytics_outbox_delivery_status_next_attempt_at_idx";

-- AlterTable
ALTER TABLE "public"."analytics_outbox" ADD COLUMN     "last_error_code" TEXT,
ADD COLUMN     "lease_expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "lease_token" UUID;

-- AlterTable
ALTER TABLE "public"."user_privacy_settings" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "analytics_outbox_delivery_status_next_attempt_at_lease_expi_idx" ON "public"."analytics_outbox"("delivery_status", "next_attempt_at", "lease_expires_at");
