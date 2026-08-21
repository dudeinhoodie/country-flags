-- The first repeat moves from one minute to one hour.
--
-- A card answered "again" used to come back inside the same sitting, which is
-- not a review: the answer is still in the reader's head, so getting it right
-- proves nothing and the queue refills as fast as it drains. The ladder is an
-- hour, three hours, then a day; a lapse comes back in an hour rather than ten
-- minutes. The weights, the retention target and the fuzz setting are
-- untouched — this changes when a card is asked, not how the algorithm thinks.
--
-- Per ADR-004 a parameters change is a new immutable definition rather than an
-- edit: reviews already accepted keep the version they were scheduled under,
-- and their history replays exactly as before. This also installs the first
-- definition a fresh database has ever had — until now nothing created one,
-- and a review against an empty scheduler table answers 503.

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
  'fsrs-6-2026-08-21',
  'FSRS',
  6,
  'ts-fsrs',
  '5.4.1',
  'fsrs-6-default-21-v2',
  '{"request_retention":0.9,"maximum_interval":36500,"w":[0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542],"enable_fuzz":false,"enable_short_term":true,"learning_steps":["1h","3h","1d"],"relearning_steps":["1h"]}'::jsonb,
  0.900,
  'ACTIVE',
  now(),
  now()
)
ON CONFLICT ("version") DO UPDATE
SET "status" = 'ACTIVE',
    "active_from" = COALESCE("public"."scheduler_definitions"."active_from", now());
