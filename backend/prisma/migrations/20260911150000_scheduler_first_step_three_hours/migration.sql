-- The first repeat moves from one hour to three.
--
-- The product answers with a swipe — left is "again", right is "good" — so
-- after ADR-013 the hour was the only rung a card ever came back on before
-- the afternoon was out: a first "good" already waited three hours. The owner
-- wants the deck back once every three hours, and this is that floor. The
-- ladder is three hours, three hours, then a day; a lapse comes back in three
-- hours rather than one. The weights, the retention target and the fuzz
-- setting are untouched — this changes when a card is asked, not how the
-- algorithm thinks (ADR-022).
--
-- Per ADR-004 a parameters change is a new immutable definition rather than an
-- edit: reviews already accepted keep the version they were scheduled under,
-- and their history replays exactly as before.

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
  'fsrs-6-2026-09-11',
  'FSRS',
  6,
  'ts-fsrs',
  '5.4.1',
  'fsrs-6-default-21-v3',
  '{"request_retention":0.9,"maximum_interval":36500,"w":[0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542],"enable_fuzz":false,"enable_short_term":true,"learning_steps":["3h","3h","1d"],"relearning_steps":["3h"]}'::jsonb,
  0.900,
  'ACTIVE',
  now(),
  now()
)
ON CONFLICT ("version") DO UPDATE
SET "status" = 'ACTIVE',
    "active_from" = COALESCE("public"."scheduler_definitions"."active_from", now());
