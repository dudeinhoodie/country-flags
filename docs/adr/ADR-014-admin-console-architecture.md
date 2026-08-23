# ADR-014: Admin console architecture and content release path

- Status: Proposed
- Date: 2026-08-23

## Context

Catalog data — decks, localized names, ordered deck membership, flags and
future coats of arms — is edited today by hand-editing
`tools/content-pipeline/editorial/catalog.json` and shipping it through the
content pipeline. A release is built, signed and published by the
`publish-content-dev.yml` workflow into an immutable `ContentRelease`, and
clients only ever read the active version through the public `/v1` API.

Two properties of that release path are load-bearing and must not be
weakened by an editing UI:

1. The bundle signing key lives in GCP Secret Manager and is issued to the
   workflow job through Workload Identity Federation; the backend knows only
   the public keys. Moving the key into a service that accepts browser input
   would reduce the signature to "built by the same process that accepted
   the input".
2. Publishing applies one `Serializable` transaction with a timeout of up to
   20 minutes over a direct (non-pooled) database connection. That does not
   fit an HTTP request into a scale-to-zero Cloud Run service.

In addition, `catalog.json` already has an automated writer: the
`content-source-refresh.yml` workflow re-imports pinned upstream sources and
opens a draft PR. Any admin design that treats the database as the sole
source of truth for that file turns the refresh workflow into a writer into
a dead file or a source of systematic drift.

## Decision

Build the admin console as a fourth workspace `admin/` in the monorepo:

- **React Admin OSS 5** on React, TypeScript, Vite and MUI, deployed as a
  static SPA in an nginx container that proxies `/api/*` to the backend so
  the browser stays same-origin;
- a **custom DataProvider** over a dedicated NestJS admin API under
  `/v1/admin/*`; the UI never talks to Prisma or the database directly;
- a **separate OpenAPI contract root** for the admin API, so admin
  operations never leak into the canonical client contract consumed by the
  iOS generator;
- **runtime configuration**, not build-time: the container writes
  `/config.json` (environment, `/api` base path, public Google client id,
  deployed version) at startup, and one immutable image is promoted
  dev → prod. The SPA refuses to start on a missing or invalid config, shows
  a permanent environment badge and renders prod visually distinct;
- **separate admin identity**: admin users, sessions and an email allowlist
  are distinct from consumer accounts; roles are enforced on the backend.

Editing follows a draft/proposal model with a two-phase release path:

- **Phase 1 (this version).** The admin edits a versioned draft in the
  database (imported from `catalog.json` at a recorded base commit),
  validates it with the same code the CLI pipeline uses, reviews a diff
  against the active version, and releases a **proposal**: a deterministic,
  byte-stable export committed to a branch and opened as a draft pull
  request. The existing `publish-content-dev.yml` workflow remains the only
  publisher; the admin console can at most dispatch it and poll the result.
  Ownership of `catalog.json` is split by layer: source snapshots and
  source-derived facts belong to the refresh workflow, the editorial layer
  (decks, localizations, membership, overrides, asset overrides) belongs to
  the admin console, and both writers merge exclusively through pull
  requests — git review stays the single merge point.
- **Phase 2 (explicitly out of scope).** Moving publish and rollback into
  the product requires a separate ADR answering key custody, the runtime
  for the long transaction, publisher credential isolation and active
  pointer locking. Until that ADR exists, no publish endpoint appears in
  the admin contract.

## Alternatives considered

- **Refine** — viable and more headless, but requires assembling more of
  the standard admin screens by hand than React Admin for the same result.
- **AdminJS** — built for CRUD directly over ORM models; publishing here
  must go through domain validation, immutable release assembly and an
  atomic active-pointer switch, so ORM-level editing is the wrong shape.
- **Directus / Strapi** — would introduce a second content model and a
  second source of truth next to the existing pipeline.
- **Publishing from the admin service in the first version** — rejected;
  it would move the signing key across a trust boundary and put a
  20-minute serializable transaction behind an HTTP request (see Context).

## Consequences

- Clients are untouched: drafts never leak into published tables or the
  public `/v1` contract, and the client bundle must be proven (by CI tests)
  to contain no `/v1/admin` paths.
- The editorial cycle gains a UI but keeps human review: every change —
  human or bot — reaches `master` as a reviewable, deterministic diff.
- Publishing stays an intentional, audited action in CI with its existing
  concurrency guard; the admin console adds observability, not a second
  publisher.
- A manual flag upload needs an explicit asset-override layer in the
  content pipeline (with conflict reporting against adapter candidates), or
  the next source refresh would silently overwrite it.
- The `admin/` workspace joins every root quality gate (`build`, `format`,
  `format:check`, `lint`, `typecheck`, `test`, `test:ci`), so backend CI
  checks it on every pull request.
