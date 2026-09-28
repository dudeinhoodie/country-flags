# ADR-026: the learning step is part of a card's scheduler state

- Status: Accepted
- Date: 2026-09-26
- Follows: [ADR-004](./ADR-004-fsrs6-versioning-and-migrations.md), [ADR-022](./ADR-022-first-repetition-after-three-hours.md), [ADR-024](./ADR-024-two-answers-not-four.md)
- Issue: #435

## Context

ts-fsrs keeps a card's place on its learning or relearning ladder in
`learning_steps`: the index of the rung the card stands on. The adapter never
stored it and handed every answer to ts-fsrs as if the card stood on the first
rung. With the ladder of ADR-022, `["3h", "3h", "1d"]`, a `GOOD` on the first
rung asks for the second, three hours out, and leaves the card in `LEARNING`.
So a card answered `GOOD` came back every three hours and never reached
`REVIEW`. The only way out was `EASY`, and since ADR-024 the app sends only
`AGAIN` and `GOOD`.

The two rungs are three hours apart alike, so neither the due date nor the
stage can tell which one a card is on. The step has to be stored.

## Decision

1. `SchedulerCardState` carries `learningStep`, and `user_card_states` stores it
   in a `learning_step` column (non-negative, default zero). Review base
   projections and scheduler migration checkpoints carry it too; a snapshot
   written before the field existed means step zero, which is what every answer
   started from until then.
2. The fix is a new immutable scheduler definition, `fsrs-6-2026-09-26` with
   parameters version `fsrs-6-default-21-v4`. The ts-fsrs parameters are the v3
   ladder unchanged. What changes is the adapter's contract: under v4 an answer
   starts from the step the previous answer left the card on. Reviews accepted
   under v1 to v3 keep their definition and replay exactly as they were
   scheduled, starting at step zero, as ADR-004 requires. The set of
   step-resetting versions is closed, so a later version cannot fall back into
   the bug by forgetting to opt in.
3. Existing card states are queued by the scheduler migration worker, replayed
   from immutable history and published under the new definition with a
   checkpoint. The step crosses with the rest of the memory state.
4. The iOS local projection follows the same ladder without FSRS arithmetic. A
   new card answered `AGAIN` stays in `LEARNING`; two `GOOD` answers in a row
   graduate a learning card to `REVIEW` a day out; `GOOD` after a lapse returns
   the card to `REVIEW` a day out. Past graduation it stays conservative and
   never promises more than a day, because the server's state replaces it on
   the next sync. Where it cannot know the server's step — a canonical
   `LEARNING` state from the server — it asks for the card three hours out,
   which is never later than the server would.

## Consequences

- `GOOD`, `GOOD` from a new card now reads three hours, then a day in `REVIEW`,
  then growing FSRS intervals, matching ts-fsrs. Golden sequences
  `fsrs-6-default-v4.json` and `fsrs-6-default-v4-again.json` pin it on both
  sides.
- For the same answers played on the device, the iOS projection and the server
  agree on the state and on every due date up to a day; past that the device's
  date is never later than the server's. The one state they disagree on is an
  `AGAIN` on a `REVIEW` card whose stability keeps it in `REVIEW` on the server:
  the device calls it `RELEARNING` three hours out, the sooner answer.
- The production database is still empty, so the replay costs nothing there.
  Dev data is replayed by the worker after deploy.

## Migration path

Deploy applies `20260926120000_scheduler_carries_learning_step`, which adds the
column, retires the active definition and installs the new one. The scheduler
migration worker reconciles every card state whose version differs. Rolling
back means reactivating `fsrs-6-2026-09-11`; its replay ignores the stored step,
so the column can stay.
