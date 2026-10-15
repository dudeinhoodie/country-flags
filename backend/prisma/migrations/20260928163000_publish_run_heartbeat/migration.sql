-- A release run whose job dies stays RUNNING (#452).
--
-- A killed job writes nothing on its way out, so its run kept the only live
-- slot of `publish_runs_single_active_idx` for good, and only a QUEUED run
-- could be cancelled. Every later publish and rollback from the console was
-- refused, and the database was the only remedy. The executor now reports a
-- heartbeat while it works. A RUNNING run that has gone unheard for longer
-- than the lease has lost its job, and the console may give it up.

ALTER TABLE "public"."publish_runs" ADD COLUMN "heartbeat_at" TIMESTAMPTZ(3);

-- A run claimed before this column existed was last known alive when it
-- started. Without a value the lease below could not be judged at all.
UPDATE "public"."publish_runs"
SET "heartbeat_at" = COALESCE("started_at", "created_at")
WHERE "status" = 'RUNNING';

-- The claim writes the first heartbeat in the same statement that moves the
-- run to RUNNING. A RUNNING run without one would be a run nobody could ever
-- tell was abandoned, which is the state this migration exists to end.
ALTER TABLE "public"."publish_runs"
  ADD CONSTRAINT "publish_runs_running_heartbeat_check"
  CHECK ("status" <> 'RUNNING' OR "heartbeat_at" IS NOT NULL);
