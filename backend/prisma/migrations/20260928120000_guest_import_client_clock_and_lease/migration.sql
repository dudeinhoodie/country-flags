-- Guest imports keep the time a guest actually studied, and run once at a time
-- (issue #452).
--
-- `CLIENT_CLOCK` marks a review whose effective time is the client's own
-- clock: a guest never saw the server clock, so there is no calibrated
-- estimate, and falling back to the time of the import collapsed weeks of
-- study into one instant. The server still bounds it (not before the content
-- release was published, not in the future).
--
-- The lease makes a retried import wait for the first attempt instead of
-- replaying the same reviews beside it. Only the holder of an unexpired
-- `lease_token` may write the operation's outcome; an expired lease belongs to
-- an attempt that died, and the next retry takes it over.

ALTER TYPE "public"."TimeConfidence" ADD VALUE 'CLIENT_CLOCK';

ALTER TABLE "public"."guest_import_operations"
  ADD COLUMN "lease_token" UUID,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(3);
