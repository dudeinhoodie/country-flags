-- A draft symbol carries its own validity and its own story.
--
-- The published `assets` table already has both (20260905120000), but the
-- editor works on `draft_assets`, and until now a coat of arms uploaded
-- there had nowhere to record when it came into force or what it is
-- called. Retiring a symbol is setting `valid_to`, not deleting the row:
-- the draft keeps the drawing that used to be the answer, and the audit
-- trail keeps the act.
--
-- Localizations stay a JSONB document here rather than a side table. A
-- draft is a staging area edited as a whole and thrown away on merge; the
-- publisher is what turns this into `asset_localizations` rows.

ALTER TABLE "public"."draft_assets"
  ADD COLUMN "valid_from" DATE,
  ADD COLUMN "valid_to" DATE,
  ADD COLUMN "localizations" JSONB;
