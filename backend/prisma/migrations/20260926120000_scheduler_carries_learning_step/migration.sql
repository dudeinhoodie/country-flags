-- The learning step becomes part of a card's scheduler state.
--
-- Until now the adapter handed ts-fsrs every answer as if the card stood on
-- the first rung of its ladder. With `learning_steps: ["3h", "3h", "1d"]` a
-- `GOOD` on the first rung asks for the second, three hours out, so a card in
-- LEARNING answered `GOOD` came back in three hours every time and never
-- reached REVIEW. The two rungs are three hours apart alike, so neither the due
-- date nor the stage can say which one a card is on: the step has to be stored.
--
-- Per ADR-004 the fix is a new immutable definition, not an edit. Reviews
-- accepted under `fsrs-6-2026-09-11` keep that version and replay exactly as
-- they were scheduled; the adapter keeps starting their answers at step zero.
-- The ts-fsrs parameters are the v3 ladder unchanged. The parameters version
-- moves to v4 because the same answers replay to different due dates under the
-- two contracts, and a stored review must say which one scheduled it
-- (ADR-026).
--
-- Every existing row starts at step zero, which is what the old adapter
-- assumed. Its scheduler version no longer matches the active one, so the
-- scheduler migration worker queues it; the reconciliation replays its
-- immutable history, records the step ts-fsrs returned for the last answer and
-- publishes the projection under the new definition together with a
-- checkpoint.

ALTER TABLE "public"."user_card_states"
  ADD COLUMN "learning_step" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "public"."user_card_states"
  ADD CONSTRAINT "user_card_states_learning_step_check" CHECK ("learning_step" >= 0);

UPDATE "public"."scheduler_definitions"
SET "status" = 'RETIRED'
WHERE "status" = 'ACTIVE';

INSERT INTO "public"."scheduler_definitions" (
  "version",
  "algorithm",
  "algorithm_major",
  "package_name",
  "package_version",
  "parameters_version",
  "parameters",
  "default_desired_retention",
  "status",
  "active_from",
  "created_at"
) VALUES (
  'fsrs-6-2026-09-26',
  'FSRS',
  6,
  'ts-fsrs',
  '5.4.1',
  'fsrs-6-default-21-v4',
  '{"request_retention":0.9,"maximum_interval":36500,"w":[0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542],"enable_fuzz":false,"enable_short_term":true,"learning_steps":["3h","3h","1d"],"relearning_steps":["3h"]}'::jsonb,
  0.900,
  'ACTIVE',
  now(),
  now()
)
ON CONFLICT ("version") DO UPDATE
SET "status" = 'ACTIVE',
    "active_from" = COALESCE("public"."scheduler_definitions"."active_from", now());
