# ADR-010: Offline study session import

- Status: Accepted
- Date: 2026-08-08

## Context

`docs/02-ios-spec.md` §8.1 requires a client that lost network to assemble a
study session locally, keep it under a client-generated UUID with
`selectionOrigin=CLIENT_OFFLINE`, and on the next sync first create the session
on the backend idempotently and only then send the reviews that depend on it.
The committed contract already described `CreateOfflineStudySessionRequest`, but
the runtime accepted `SERVER` only, so the whole offline path was unreachable
(issue #64, recorded as open question 1 in `docs/15-ios-client-readiness.md`).

Three properties of the existing system constrain the import.

1. A study session card is a reproducible snapshot. `study_session_cards` pins
   `learning_card_revision_id` and stores the rendered snapshot as JSONB, and
   `study_sessions.content_version` is a foreign key to `content_releases`.
2. Review history is immutable and objective grading is server-owned:
   `POST /v1/reviews/batch` grades a `MULTIPLE_CHOICE` answer by looking up the
   submitted `selectedOptionId` among the option rows persisted with the
   session, and `docs/08-backend-agent-handoff.md` §9 states the client never
   declares `isCorrect` for objective mode.
3. `StudyOption` — the only option shape the contract carries, in both the
   request and the response — is `{ id, position, displayName }`. It has no
   answer entity identity.

## Decision

- The offline variant is accepted on the existing `POST /v1/study-sessions`
  operation, discriminated by `selectionOrigin`. No iOS-specific route and no
  handwritten DTO diverging from `contracts/openapi.yaml`.
- The client composition is authoritative for what only the client knows: the
  session `id`, `startedAt`, `contentVersion`, the card order and the per-card
  `randomSeed`.
- Everything a client must not be trusted with is rebuilt server-side inside the
  same serializable transaction: the learning card snapshot (from the declared
  revision and canonical content), `selectionReason` (from canonical card
  state), `initialOrder`, the session card IDs and `schedulerVersion`. The
  submitted `snapshot` is validated for identity agreement (`id`, `revision`)
  and then discarded, so a client cannot inject content into a response other
  clients read back.
- `startedAt` is preserved unless the device clock runs further ahead than
  `MAX_FUTURE_SKEW_MS`, the same tolerance review ingestion and session
  completion already use; beyond it the server receive time wins.
- Idempotency keeps the SERVER semantics: the primary key on `study_sessions.id`
  plus a stored `request_hash` inside a serializable transaction. A repeated
  identical composition returns `200` with the stored snapshot, a different
  composition for the same ID returns `409`. The hash covers the normalized
  composition, not the raw body, because the server rebuilds the snapshot.
- **Objective mode is refused, not regenerated.** An offline `MULTIPLE_CHOICE`
  session, and any card carrying `options` or a non-null
  `distractorPolicyVersion`, is rejected with
  `422 OFFLINE_MODE_UNSUPPORTED`.
- **A superseded content version is accepted.** The declared `contentVersion`
  must reference a content release that is not `DRAFT`; a release that the
  catalog never published is rejected with `422 CONTENT_VERSION_UNKNOWN`.
- **A card retired after the offline selection is refused.** Composition
  validation requires every declared card to be a member of the deck, `ACTIVE`,
  to declare a live revision and to carry the prompt asset checksum that
  revision still has. Any violation rejects the whole import with
  `422 OFFLINE_SESSION_COMPOSITION_INVALID` and per-card reasons
  (`NOT_IN_DECK`, `RETIRED`, `REVISION_UNKNOWN`, `ASSET_MISMATCH`). The import
  is atomic: a rejected composition never leaves a partial session.

### Why objective mode is refused

Two reconstructions are conceivable and both break an invariant.

- *Bind the submitted options.* The contract carries only a localized
  `displayName` per option, so the server would have to resolve the answer
  entity from a display string and derive correctness from it. That is exactly
  what the multiple-choice contract forbids (`docs/ios/tasks/IOS-007`: "do not
  compute correctness from the display string; use immutable IDs and versioned
  snapshots"), and homograph or alias collisions would silently mis-grade.
- *Regenerate options server-side.* The generated option IDs are derived from
  the session card ID and the distractor pool, so they would not match the
  option IDs the device already recorded in its pending reviews. Every offline
  answer would then be rejected as `OPTION_NOT_IN_SESSION` — the import would
  appear to succeed while destroying the learner's answers.

A typed refusal is therefore the only outcome that neither fabricates grading
nor silently discards review data. It is the option the issue explicitly
allows, and it keeps `docs/01-backend-spec.md` §5.4's offline objective
paragraph as future work rather than implementing it on a contract that cannot
express canonical option identity.

### Why a superseded content version is accepted but a retired card is not

They answer different questions. `contentVersion` records *what the learner
studied*; releases are immutable and the foreign key stays valid, so keeping the
declared version makes the session reproducible and honest. A retired card
instead asks *may this content still produce new progress*, and the answer for a
card the catalog withdrew is no — the same rule server selection already
applies. A client that hits this stops retrying: the rejection is not
recoverable, so the outbox surfaces it as a permanent failure and the reviews of
that session are not importable.

## Consequences

- The §8.1 offline flow works end to end for `SELF_RATED`, which unblocks the
  iOS outbox and `SyncCoordinator` work (issue #57).
- Offline objective study has no server-side landing path. A client must not
  offer `MULTIPLE_CHOICE` without network, or must be prepared to drop such a
  session permanently.
- A content release that retires a card invalidates any offline session already
  assembled against it. This is rare by construction (content retirement is a
  deliberate catalog action) but it does lose the learner's offline answers for
  that session, and the client must report it rather than retry.
- The persisted snapshot may differ from the one the device rendered when
  localized names changed between the offline selection and the sync; the server
  value is canonical.
- No schema change and no migration: the existing primary key, the
  `(session_id, learning_card_id)` and `(session_id, initial_order)` unique
  constraints and the `content_version` foreign key already enforce every
  invariant this decision relies on.

## Alternatives

- *Accept the client snapshot verbatim.* Cheapest, but it lets a client write
  arbitrary content (including asset URLs) into a record other clients read
  back, and it breaks reproducibility from immutable content.
- *Require the declared `contentVersion` to be the currently active release.*
  Rejects every offline session that outlived one content publish, which is the
  normal case for a device that was offline for a while.
- *Accept retired cards.* Preserves more offline work, but lets withdrawn
  content generate new progress and contradicts the selection invariants.
- *Extend the contract with an `answerEntityId` per offline option.* Would make
  offline objective import expressible, but it is a contract change the iOS
  client work does not need yet and it widens what a client declares about
  grading. Left as the revisit path below.

## Revisit triggers

- Offline objective study becomes a product requirement: add an offline option
  shape carrying immutable answer entity identity, keep client option IDs, and
  derive `isCorrect` server-side from the declared content version.
- Deck membership or card status becomes versioned per content release, which
  would allow validating a composition against the release it was built from
  instead of the current catalog.
