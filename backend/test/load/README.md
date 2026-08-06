# Load & Abuse Tests (k6)

Basic abuse/concurrency checks for the critical flows named in issue #15 — not a
substitute for real production capacity planning (this repo has no staging
environment to run that kind of test against). These scripts prove two things:

1. The Postgres-backed rate limiter (`backend/src/common/security/rate-limiter.service.ts`)
   actually trips under concurrent load and returns `429` + `Retry-After`, not just in a
   unit test with a mocked clock.
2. A short burst of concurrent mixed read/write traffic against one account doesn't leak
   `5xx`s or blow past sane latency budgets (connection-pool exhaustion, N+1-under-load).

## Requirements

- [k6](https://k6.io/docs/get-started/installation/) installed locally, or use the
  `grafana/k6-action` step already wired into
  `.github/workflows/load-test.yml` (manual trigger only).
- A running backend against a migrated database — `yarn app:up` (or `yarn db:up` +
  `yarn start:dev`), NOT production.

## Generating a test access token

`reviews-batch-abuse.js` and `mixed-critical-flows.js` need a bearer token:

```bash
corepack yarn workspace @country-flags/backend study:token:test
```

This prints a long-lived `TEST_ONLY` access token for the seeded test study user (see
`backend/src/cli/print-test-access-token.ts`). Never usable in production —
`TEST_AUTH_ENABLED`/test signing are hard-disabled there
(`backend/src/config/environment.validation.ts`).

## Running

```bash
k6 run -e BASE_URL=http://localhost:3000 backend/test/load/k6/auth-login.js

ACCESS_TOKEN="$(corepack yarn workspace @country-flags/backend study:token:test)"
k6 run -e BASE_URL=http://localhost:3000 -e ACCESS_TOKEN="$ACCESS_TOKEN" \
  backend/test/load/k6/reviews-batch-abuse.js
k6 run -e BASE_URL=http://localhost:3000 -e ACCESS_TOKEN="$ACCESS_TOKEN" \
  backend/test/load/k6/mixed-critical-flows.js
```

## What these scripts do NOT prove

- `reviews-batch-abuse.js` and `mixed-critical-flows.js` submit shape-valid but
  synthetic review events (random UUIDs, no real seeded card) — they exercise the rate
  limiter and endpoint concurrency, not full review-ingestion business logic. Point
  `CARD_ID` at a real seeded card (`yarn content:import:test`) if you also want realistic
  200s instead of 404/422 domain responses.
- `auth-login.js` relies on every k6 VU sharing one source IP (they all run from the same
  host) — that's the actual scenario the per-IP `auth:google` limit exists to bound, not
  a gap in the test.
- None of this is wired into `pull_request`/`push` — it's `workflow_dispatch` only
  (`.github/workflows/load-test.yml`), matching the existing `content-source-refresh.yml`
  pattern for checks that shouldn't gate every PR.
