-- The scheduler migration worker asks every poll whether any card state is on
-- a scheduler version other than the active one (issue #452). With no index on
-- `scheduler_version` the answer "none" was a full scan of `user_card_states`,
-- on every instance, every two seconds. The worker now reads the lowest and
-- the highest version from this index, two index endpoints, and the page query
-- of a running migration can use it too.
--
-- A plain CREATE INDEX rather than CONCURRENTLY: before the first release the
-- table is small, and the write lock it takes lasts as long as the build.

-- CreateIndex
CREATE INDEX "user_card_states_scheduler_version_idx" ON "public"."user_card_states"("scheduler_version");
