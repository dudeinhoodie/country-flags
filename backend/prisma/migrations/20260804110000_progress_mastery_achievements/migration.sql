-- Mastery rule v1 is immutable. Future threshold changes insert new definitions
-- with a new rule_version instead of updating earned achievement evidence.
INSERT INTO "public"."achievement_definitions" (
  "id",
  "code",
  "category",
  "tier",
  "rule_version",
  "rule_spec",
  "active_from"
) VALUES
  (
    'a1000000-0000-4000-8000-000000000001',
    'MASTERY_BRONZE',
    'MASTERY',
    'BRONZE',
    1,
    '{"coverage":0.5,"successfulReviewsPerCard":1,"accuracy30Days":0.7,"minimumSuccessfulReviews":5,"maximumOverdueRatio":1}',
    '2026-01-01T00:00:00.000Z'
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    'MASTERY_SILVER',
    'MASTERY',
    'SILVER',
    1,
    '{"coverage":0.75,"successfulReviewsPerCard":2,"accuracy30Days":0.8,"minimumSuccessfulReviews":10,"maximumOverdueRatio":1}',
    '2026-01-01T00:00:00.000Z'
  ),
  (
    'a1000000-0000-4000-8000-000000000003',
    'MASTERY_GOLD',
    'MASTERY',
    'GOLD',
    1,
    '{"coverage":0.9,"successfulReviewsPerCard":2,"accuracy30Days":0.9,"minimumSuccessfulReviews":20,"maximumOverdueRatio":1}',
    '2026-01-01T00:00:00.000Z'
  ),
  (
    'a1000000-0000-4000-8000-000000000004',
    'MASTERY_PLATINUM',
    'MASTERY',
    'PLATINUM',
    1,
    '{"coverage":1,"successfulReviewsPerCard":3,"accuracy30Days":0.95,"minimumSuccessfulReviews":30,"maximumOverdueRatio":0.1}',
    '2026-01-01T00:00:00.000Z'
  );

INSERT INTO "public"."achievement_localizations" (
  "definition_id",
  "locale",
  "title",
  "description"
) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'en', 'Bronze mastery', 'Reach Bronze mastery in a deck or region.'),
  ('a1000000-0000-4000-8000-000000000001', 'ru', 'Бронзовое освоение', 'Достигните бронзового уровня в колоде или регионе.'),
  ('a1000000-0000-4000-8000-000000000002', 'en', 'Silver mastery', 'Reach Silver mastery in a deck or region.'),
  ('a1000000-0000-4000-8000-000000000002', 'ru', 'Серебряное освоение', 'Достигните серебряного уровня в колоде или регионе.'),
  ('a1000000-0000-4000-8000-000000000003', 'en', 'Gold mastery', 'Reach Gold mastery in a deck or region.'),
  ('a1000000-0000-4000-8000-000000000003', 'ru', 'Золотое освоение', 'Достигните золотого уровня в колоде или регионе.'),
  ('a1000000-0000-4000-8000-000000000004', 'en', 'Platinum mastery', 'Reach Platinum mastery in a deck or region.'),
  ('a1000000-0000-4000-8000-000000000004', 'ru', 'Платиновое освоение', 'Достигните платинового уровня в колоде или регионе.');
