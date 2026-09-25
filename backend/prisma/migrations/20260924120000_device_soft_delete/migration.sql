-- Removing a device marks it instead of deleting the row (issue #439).
--
-- `review_events.device_id` references the device `ON DELETE SET NULL`, which
-- PostgreSQL runs as an UPDATE of the review event, and `review_events`
-- refuses every UPDATE. Deleting a device that ever answered a card therefore
-- rolled back the whole transaction, including the revocation of its refresh
-- sessions. The row now stays, so immutable history keeps its reference, and
-- `deleted_at` records that the user removed it. The rows are still erased
-- with the account, after its review events.

ALTER TABLE "public"."devices" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);
