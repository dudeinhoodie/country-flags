# ADR-024: two answers, not four

- Status: Accepted
- Date: 2026-09-21
- Follows: [ADR-022](./ADR-022-first-repetition-after-three-hours.md)

## Context

FSRS-6 grades a review on four levels, and the app was built to match: `AGAIN`,
`HARD`, `GOOD`, `EASY` in the contract, in Prisma, in the local projection and
in the study screen's rating bar.

The rating bar is gone. A card is answered by a swipe — right is `GOOD`, left is
`AGAIN` — and there is no third gesture. ADR-022 recorded the change in passing
and kept the middle grades alive in two places: as VoiceOver actions, because
`StudySessionView` iterated `StudyRating.allCases`, and as rungs in
`LocalSchedulerProjection` that were kept "for the accessibility actions".

Two grades nothing produces are not a spare feature. They are a second
semantics, and they cost:

- the accepted request body is wider than the product, so a client may write a
  card state no learner could have asked for;
- the offline projection carries branches no swipe reaches, which drift because
  nothing exercises them;
- `HARD` hides a real defect. In the `LEARNING` state ts-fsrs repeats the
  current step, and with `learning_steps: ["3h", "3h", "1d"]` that step is
  three hours whichever rung the card is on. Replaying thirty consecutive
  `HARD` answers through the adapter leaves the card in `LEARNING` every time,
  still three hours out, with stability crawling from 1.29 to 3.03. The only
  way to reach that state was a VoiceOver action, so it was a trap set for
  exactly the learners least able to see it.

There are no production clients to migrate: Prod has no working Sign in with
Apple (#302) and no reachable host (#301).

## Decision

A client may submit `AGAIN` and `GOOD`. Stored reviews keep all four.

The two vocabularies are named separately rather than merged:

- `Rating` in the OpenAPI components keeps `[AGAIN, HARD, GOOD, EASY]`. It is
  what a stored review can hold and what `ReviewResult.canonicalRating` echoes.
- `SubmittedRating` is new, `[AGAIN, GOOD]`, and is what `SelfRatedReviewEvent`
  now references. `parseReviewBatchRequest` rejects anything else with the usual
  typed validation error.
- `ReviewRating` in Prisma is unchanged. Review history is immutable (ADR-004),
  so a value recorded under the four-grade screen must keep replaying; removing
  it from the enum would orphan the rows that hold it.
- `Fsrs6SchedulerAdapter` keeps mapping all four grades, for the same reason.
  The golden fixtures, which replay a four-answer sequence, are untouched.
- `guest-import.v1.schema.json` is unchanged and still accepts all four. It
  imports reviews a guest already recorded; a guest who answered `HARD` through
  VoiceOver owns that history, and narrowing here would lose their progress
  rather than tidy it.
- On iOS, `StudyRating` has two cases. The VoiceOver actions offer exactly the
  two answers a swipe can produce, and `LocalSchedulerProjection` has two rungs:
  three hours for `again`, three hours for a first `good` and a day afterwards.

## Consequences

- The contract narrows where a client writes and stays wide where the server
  reports, so `contracts:compat` sees no enum value removed and the API keeps
  its major version. This is not a way around the check: the set of grades the
  system can store genuinely differs from the set a client may send, and the
  schemas now say so.
- A request carrying `HARD` or `EASY` is rejected rather than silently mapped.
  Mapping would have invented an answer on the learner's behalf.
- The `HARD` loop is unreachable. Nothing about the scheduler changed; the grade
  that reached the trap can no longer be sent.
- `buildSessionSummary` keeps four counters, because it counts stored reviews
  and an imported session may hold the old grades.
- ADR-022's reason for keeping four rungs in the local projection no longer
  holds, and the comment there is updated to say why.

## Alternatives

- **Narrow `Rating` itself.** Honest at a glance, but wrong: the stored
  vocabulary really is four wide, and the compatibility checker is right that
  removing a value from a schema the server still emits is breaking.
- **Accept `HARD` and `EASY` and map them onto `GOOD`.** Keeps old clients
  working, but records an answer the learner did not give, in a history that is
  meant to be replayable exactly.
- **Leave the grades and fix only the `HARD` loop.** Treats the symptom. The
  grades would still be a vocabulary the product cannot speak, and the next
  parameter change would have to reason about rungs nothing lands on.
