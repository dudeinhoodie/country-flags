# ADR-021: Bundled catalogue snapshot, superseded by the first sync

- Status: Accepted
- Date: 2026-09-07
- Extends: [ADR-011](./ADR-011-bundled-flag-baseline.md)
- Issue: [#301](https://github.com/dudeinhoodie/country-flags/issues/301) (the
  client half; the production backend is the other half and is not this)

## Context

ADR-011 put the drawings of one pinned content release inside the binary so
that "the first launch renders flags with no network and no CDN". It bundled
the images and left the catalogue they belong to on the network. Every deck,
card and entity still arrives from `getContentManifest` + `getContentChanges`
through `ContentBootstrapCoordinator`.

So the promise was only half kept. A fresh install with no reachable backend
shows the blocking launch screen, waits out the request timeout with its
retries, and lands on "You are offline / Get online to download the catalogue"
over three empty tabs — with 250 flags sitting in the bundle and nothing to
draw them for. That is what a reviewer sees when the host does not answer, and
it reads as guideline 2.1: an app that does not work. It is also the plane
case: guest mode needs no account and works entirely offline once the
catalogue is there, and it is worth nothing while the first launch cannot fill
itself.

The catalogue is not big. Projected from `content/generated/fixture-v1` in the
two languages the release publishes, it is about 1.2 MB of JSON beside the 14
MB of rasterised flags the same release already ships. ADR-011's revisit
trigger is "tens of megabytes"; this is nowhere near it.

What is not small is the mismatch of identifier spaces. The backend allocates
content identifiers in its database. Nothing outside one deployment maps a
content key to a UUID, so a snapshot generated at build time cannot carry the
identifiers a server will hand out for the same cards. Everything below follows
from that one fact.

## Decision

The application ships a catalogue snapshot of the same content release its
flags come from, seeds an empty store from it before touching the network, and
throws it away whole the first time a real release arrives.

- **Generated, never authored.** `ios/Scripts/sync-bundled-catalog.mjs` writes
  `BundledCatalog.json` from `content/generated/<version>`, and `--check` runs
  in CI, exactly as ADR-011 arranged for the images. A build cannot ship a
  catalogue no release ever published. The release version is one constant
  shared with `sync-flag-assets.mjs` and `sync-mock-content.mjs`, so the
  drawings, the mock and the catalogue always describe the same publication.

- **Only what a stranger may see.** The snapshot carries what an
  unauthenticated caller would be served, and it does not invent a second rule
  for that: a deck is open when `DeckAccessService.isGranted(deck, null)` says
  so, and cards, entities and assets are classified by the reach rules of
  `ContentAccessProjectionService` — `PUBLIC`, `PUBLIC_PREVIEW`, `PAID_ONLY`.
  A deck somebody has to buy contributes its metadata and its published
  preview; its cards stay behind the entitlement guard. This is ADR-011's
  2026-09-04 addendum applied to the catalogue rather than a new position on
  paid content.

- **Stored under a content version of its own.** The seeded release is
  `bundled:<release>` and never the release's own version. This is the
  load-bearing detail. Reads answer from the release the current manifest
  names; under the release's own version the derived identifiers and a
  server's allocated ones would both answer every read and every deck would
  appear twice.

- **Seeded only into an empty store.** `seedFromBundleIfEmpty` does nothing
  whenever a manifest is stored. Whatever is there came from the server or
  from an earlier seed, and either way the bundle has nothing to add. It runs
  before the status is restored and before the first request, so the first
  frame has decks on it whether or not there is a signal.

- **Superseded whole by the first successful sync.** Because the stored
  version differs from any the server publishes, the ordinary path takes over
  by itself: the manifest fetch finds a different version and runs a full
  bootstrap, which commits the server's release and makes the seeded rows
  invisible in the same transaction. There is no merge and no special case.
  The bundle is a baseline; the backend remains the only source of truth
  ([ADR-016](./ADR-016-backend-is-the-only-source-of-truth-on-the-client.md)).

- **Content only.** Seeding writes content records. Progress lives in a store
  of its own, keyed by card and scoped to an account, and nothing in the seed
  path touches it.

- **Read the way a response is read.** The document carries every language the
  release publishes and every encoding of every asset; the device resolves the
  locale with `ContentLocaleResolver` and picks the raster with
  `RenderableRepresentation.choose`, which are the same rules `ContentService`
  applies to a real response. What is seeded is what would have been
  downloaded rather than a second interpretation of the release.

## Consequences

- A first launch with no network at all opens on the full free catalogue and
  can study it. Proved by
  `LaunchSmokeUITests.testAFirstLaunchWithNoBackendOpensOnTheBundledCatalog`,
  which launches the Mock build with an empty store and every content request
  refused; without the seed the same test never reaches a deck.

- The app binary grows by about 1.2 MB, on top of ADR-011's flags. It is JSON
  and compresses to roughly a tenth of that in the shipped archive.

- The offline banner is honest from the first frame: the catalogue is on the
  device and the sync that would refresh it failed, which is the state the app
  already had a screen for.

- **Progress made before the first successful sync does not survive it.** The
  seeded cards carry derived identifiers, the server's cards carry its own,
  and progress is keyed by card. A learner who studies offline on day one and
  then comes online keeps a store where those rows point at cards no longer in
  the current release: they are invisible in every count, which joins against
  the current release, and any session built from them is refused on import
  as `OFFLINE_SESSION_COMPOSITION_INVALID` and parked. This is a real loss and
  it is stated rather than hidden. It cannot be fixed on the client — only the
  server can say what a card's identifier is — and it is bounded by "studied
  before ever reaching the backend once". A guest's work is never uploaded
  anyway, so nothing is sent to the wrong account.

- The seeded rows stay in the store after they stop being readable, the same
  way every superseded release's rows do. Nothing prunes them today.

- The Mock build rehearses the whole sequence: it derives identifiers the same
  way, so a card seeded from the bundle and the same card served by the mock
  are the same card, and the seed-then-sync path can be watched end to end.

- A build whose document is missing or will not decode seeds nothing and
  behaves exactly as the app did before this ADR. The seed can never cost the
  launch.

## Alternatives

1. **Seed under the release's own version and reconcile by the change feed.**
   Smaller: a device whose bundle matches the server's release would need no
   download at all. Rejected because the identifiers do not match, so the two
   releases would be readable at once — every deck twice — and a paid deck
   published before the snapshot would never arrive, since the change feed
   carries only what happened after the release.

2. **Ship the API documents and answer them from a local transport.** The
   snapshot would literally be what an unauthenticated caller receives, and
   `ContentService` would do the mapping. Rejected on two counts: it puts a
   second transport inside the shipping binary, which is what the two-target
   split exists to prevent, and the contract-shaped documents are twice the
   size because a deck's cards are repeated per deck.

3. **Bundle a browse-only catalogue and refuse to compose a session from it.**
   This would avoid the orphaned progress above. Rejected: a learning app that
   cannot be learned from until it has been online has not solved the problem
   the issue is about, and the loss it avoids is smaller than the launch it
   would still break.

4. **Do nothing on the client and rely on the production backend alone.** The
   other half of #301, and necessary regardless. Rejected as a substitute: it
   leaves every first launch of a shipped app depending on a network round
   trip, and leaves the plane case dead-ended on the launch screen.

## Revisit triggers

- The catalogue grows to where shipping it stops being negligible. ADR-011's
  number holds: tens of megabytes.
- The backend gains a way to publish stable, derivable content identifiers, at
  which point the seeded release could carry the real ones, the version marker
  could go, and progress made offline would survive the first sync.
- A second client platform needs the same snapshot and cannot share the build
  step.
