# ADR-025: Product analytics goes to PostHog Cloud EU, from the backend outbox

- Status: Accepted
- Date: 2026-09-24
- Issue: #453

## Context

The product analytics pipeline has been built end to end and delivers
nothing. The app queues registered events and uploads them to
`POST /v1/analytics/events/batch`; the backend validates them against
`contracts/registries/analytics-events.json`, stores them in
`analytics_outbox`, and a worker hands them to `NoOpAnalyticsExporter`, which
drops them. Delivered rows are deleted an hour later. `docs/06` still says no
provider has been chosen.

After the first release we would therefore see installs and crashes in App
Store Connect and nothing about how the app is used: no activation, no
retention by cohort, no sign of whether the three-hour rhythm (ADR-022) brings
people back.

Consent makes this worse, not better. On a fresh install both consent
categories are `UNKNOWN`, product events are dropped until they are
`GRANTED`, and the only place to grant them is a switch in Settings that
nobody is sent to. Even a learner who does grant it stops sending after a
relaunch, because the app reads the stored choice only when Settings opens.

`docs/06` §25 lists what a product analytics provider has to offer. The
constraints that decide it here are these:

- **Server-side ingestion.** Events reach the provider from our backend, not
  from an SDK in the app. The app ships no third-party analytics code.
- **Historical timestamps.** An offline device uploads hours or days late, and
  the event has to land at the moment it happened.
- **Identity.** A random install id for a guest, a pseudonymous subject after
  sign-in, a merge of the two, and a deletion API for account deletion.
- **EU hosting** and a DPA.
- **Funnels, retention cohorts and active users**, plus raw access (SQL or
  export) so the data is not trapped.

## Decision

### PostHog Cloud EU is the product analytics provider

One PostHog organisation on the EU cloud (Frankfurt), with **two projects**:
`vexi-dev` for the dev stand and `vexi-prod` for production. Dev traffic never
lands in the production project. CI, local runs and tests keep
`NoOpAnalyticsExporter` and never reach PostHog.

This decides product analytics only. Error and crash reporting, and logs,
metrics and traces, are separate choices under `docs/06`.

### The backend exporter is the only integration

`PostHogAnalyticsExporter` implements the existing `AnalyticsExporter`
boundary and replaces the NoOp binding when the environment configures it.
The outbox, its lease, retries, dead-letter and TTL stay as they are.

Mapping from the stored envelope to a PostHog event:

| Envelope | PostHog |
| --- | --- |
| `eventName` | `event`, unchanged (`study.session_completed`) |
| `eventId` | `uuid` |
| `occurredAt` | `timestamp`. No `sent_at` is sent, so PostHog takes the timestamp as given. |
| `analyticsSubjectId`, else `anonymousId` | `distinct_id` |
| `sessionId` | `$session_id` (the backend stores it, which it does not do today) |
| `properties` | properties, unchanged |
| `context` | `platform`, `appVersion`, `build`, `locale`, `featureConfigVersion` as properties |
| — | `$geoip_disable: true` |

Events are posted in batches to the capture batch endpoint with the
project's write-only API key.

- **Deduplication** is best effort on PostHog's side: the store merges rows
  that share `uuid`, event, `distinct_id` and date, eventually rather than at
  once. Duplicates from the app are already stopped earlier, because the batch
  endpoint answers `DUPLICATE` by `eventId`. A duplicate can reach PostHog only
  when the worker retries a batch PostHog had in fact accepted. We accept that
  rare, eventually merged duplicate.
- **Geography.** Events leave from Cloud Run, so PostHog's GeoIP would place
  every learner in Frankfurt. GeoIP is disabled on every event, and the
  project discards IP addresses. Language comes from `locale`; country is not
  collected.
- **Operational events** (`category: operational`: `sync.completed`,
  `content.update_completed`) are **not exported to PostHog**. `docs/06` keeps
  them out of product funnels. They are logged as structured events, and
  their success rate becomes a log-based metric under `docs/20`.

### Identity

- A guest is its **install id** (`anonymousId`), random, stored on the device,
  never derived from the device or the account.
- A signed-in learner is an **analytics subject id**:
  `HMAC-SHA256(userId, ANALYTICS_SUBJECT_KEY)`, hex-encoded, computed by the
  backend. It is stable per account and cannot be turned back into the user id
  without a key the provider never sees. The raw user UUID, which
  `analytics-batch.service.ts` sends today, is never exported (`docs/06` §18).
- **Merge.** The first time the backend sees a batch that carries both an
  `anonymousId` and an authenticated user, it sends PostHog one `$identify`
  that folds the install into the subject. The pair is recorded in the
  database with a unique constraint, so the merge is sent once per pair rather
  than once per batch. PostHog can fold an anonymous id into an identified
  person, but it cannot merge two identified persons. That is fine here,
  because an account has exactly one subject.
- **Rotation.** The app starts a new install id on sign-out, on account
  deletion and when product analytics consent is withdrawn. The next sign-in
  folds the new install id into the same subject.
- **Deletion.** Account deletion asks PostHog to delete the subject's person
  **and its events**, using a personal API key scoped to person deletion. It
  runs as a job with retries after the account is gone, and the deletion audit
  records `analyticsProviderDeletion` as `requested`, `completed` or `failed`
  instead of today's `not_configured`. PostHog deletes events in the
  background, so completion is asynchronous. A guest's anonymous person has no
  account to delete it by. It ages out with the retention period below.

### Consent: opt-in, asked once

Product analytics stays opt-in. The product owner chose to ask once:

- After the learner's **first completed session**, once the summary has been
  dismissed, the app asks in a single system-styled prompt. Allowing and
  declining are equal choices. The prompt is not shown again once it has
  been answered or dismissed.
- Nothing product-analytic is queued before the answer. Events from that first
  session are not held back to be sent afterwards.
- The switch in Settings stays, and withdrawing there rotates the install id
  and clears the queue.
- The app loads the stored choice at launch and whenever the account scope
  changes, not only when Settings opens.
- The backend enforces it, too. For a signed-in learner it accepts product
  events only when the stored consent is `GRANTED`; today `UNKNOWN` passes.
  For a guest, whose consent the server cannot see, the batch declares the
  choice, and product events without a granted declaration are rejected with
  `CONSENT_DENIED`.

A region-based model (asking in the EU and UK, on by default elsewhere) was
considered and set aside for the first release. It would need legal advice
and a way to decide the region; it can replace this later without a data
migration.

### Retention and cost

- Product events are retained for **12 months**, which is PostHog's free-plan
  retention and within the 13-month ceiling of `docs/06` §22.
- The free tier is 1M events a month. The tracking plan (`docs/22`) budgets
  about eight events per active learner per day, which is roughly 4,000
  consenting daily learners before any charge. Beyond that PostHog bills
  $0.00005 per event from 1M to 2M a month and $0.0000343 from 2M to 15M, so
  5M events come to about $153 a month. A billing limit is set in the
  organisation so a runaway client cannot run up a bill.

### What the product owner sets up

- The EU organisation, both projects, and acceptance of the DPA.
- In each project: IP discarding enabled, the retention period, and the
  billing limit.
- In Secret Manager: `dev-posthog-project-api-key`, `prod-posthog-project-api-key`,
  and the personal API keys used for person deletion. Following the rule that
  deploy environment variables and secrets move together, the exporter is
  switched on in a deploy only together with its key.

## Alternatives considered

- **Mixpanel with EU residency.** The strongest documentation for exactly what
  our outbox needs: any past timestamp is accepted, and duplicates are dropped
  by `$insert_id` with no time window. It was set aside on cost and on its
  free-plan behaviour: about $440–610 a month at 5M events, and reports are
  blocked above the free 1M. It has no SQL.
- **Amplitude with EU residency.** A larger free tier (2M events) and about
  $225 a month at 5M. It was set aside because its documentation does not
  state how old an event may be, its `insert_id` deduplication covers only
  seven days, and its per-device throttling would force backlog flushes
  through a second API.
- **TelemetryDeck.** A privacy-first product with EU hosting, but it clamps
  timestamps older than 24 hours, has no identity merge and no deletion API,
  and is built around a client SDK.
- **Aptabase.** No users, so no retention cohorts or funnels.
- **Google Analytics 4 (Measurement Protocol).** App streams need the Firebase
  SDK's instance id, events can be at most 72 hours old, and there is no EU
  residency.
- **Self-hosted PostHog.** Officially unsupported beyond a hobby deploy, and a
  4 vCPU / 16 GB machine to run and back up. That is more infrastructure than
  the first release has people for.
- **Our own tables and SQL.** The events already reach PostgreSQL, but
  cohorts, funnels and dashboards would be an observability product of our own,
  which `docs/06` rules out for the MVP.

## Consequences

- The first release can answer activation, retention and conversion questions
  for the learners who consent. Totals such as installs and active devices
  still come from App Store Connect, and the ratio of the two is the consent
  rate.
- The app ships no analytics SDK. The App Store privacy answers still change,
  because product interaction and identifiers are now collected and linked to
  the learner.
- PostHog, Inc. becomes a processor. The privacy policy has to name it, say
  where the data is hosted and for how long, and say how to withdraw.
- Guests get person profiles in PostHog, because retention of guests is the
  question the first release most needs answered.
- Vendor lock-in is limited to dashboards. Events keep our envelope, the
  exporter is one class behind a boundary, and PostHog offers SQL and export.
  We do not archive raw events ourselves; if a second destination is ever
  needed, the outbox can feed two exporters.
- Deletion at the provider is asynchronous. The audit says when it was
  requested, and a failure is retried rather than lost.

## Revisit triggers

- Consenting volume passes 5M events a month.
- Legal advice asks for region-based consent, or allows a different basis.
- The first experiment is planned. `feature.exposed` and PostHog's experiment
  analysis are the path.
- PostHog's EU hosting, pricing or deletion API changes materially.
