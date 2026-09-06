# Runbook: deploy, rollback, migrations, backup and secrets

Status: `Implementation baseline 0.1`
Date: 6 September 2026
Signals and alerts: [20-deployment-observability.md](../20-deployment-observability.md)
Topology: [13-deployment-environments.md](../13-deployment-environments.md)

What to run, what it should print, and when to stop. Written for someone who has
not seen this system before and has nobody to ask.

Read §0 once, then jump to the section named by the alert or the task.

- [0. Before anything](#0-before-anything)
- [1. Drill: deploy to dev and verify it](#1-drill-deploy-to-dev-and-verify-it)
- [2. Rolling a release back](#2-rolling-a-release-back)
- [3. A migration failed](#3-a-migration-failed)
- [4. Readiness is failing](#4-readiness-is-failing)
- [5. A revision will not stay up](#5-a-revision-will-not-stay-up)
- [6. The database is slow or refusing connections](#6-the-database-is-slow-or-refusing-connections)
- [7. A worker backlog is not draining](#7-a-worker-backlog-is-not-draining)
- [8. A scheduled job stopped running](#8-a-scheduled-job-stopped-running)
- [9. A backup or restore drill failed](#9-a-backup-or-restore-drill-failed)
- [10. Rotating a secret](#10-rotating-a-secret)
- [11. Production](#11-production)

## 0. Before anything

You need `gcloud` authenticated as a principal with `roles/run.admin` on the
project, and `gh` authenticated against `dudeinhoodie/country-flags`.

```bash
gcloud auth list --filter=status:ACTIVE --format='value(account)'
gh auth status
```

Set these once per session. Every command below assumes them.

```bash
export PROJECT=speedy-web-235610
export REGION=europe-west3
export SERVICE=api-dev
export URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format='value(status.url)')"
echo "$URL"
# https://api-dev-6vgdmsupva-ey.a.run.app
```

If `$URL` is empty, the service does not exist in that region and no runbook
below applies. See [13-deployment-environments.md](../13-deployment-environments.md)
§6.1 for the one-time provisioning.

Two facts that will otherwise mislead you:

- **Dev scales to zero.** The first request after an idle period takes several
  seconds and starts a new process. A slow first call and an `application_started`
  line right after it are normal on dev and would be an incident on prod.
- **No alerts exist yet.** Nothing pages anybody. Everything in
  `infrastructure/monitoring/` is defined but unapplied, so today every one of
  these runbooks starts with a human noticing.

## 1. Drill: deploy to dev and verify it

A complete, safe, non-production exercise. It deploys the commit that is already
running, so nothing changes and the whole path is still exercised: image copy,
migration, revision, readiness, smoke, deployment record, job summary.

Roughly ten minutes, most of it waiting.

### 1.1 Note what is running now

```bash
gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --format='value(status.latestReadyRevisionName)'
# api-dev-00127-nmd

gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --format='value(spec.template.spec.containers[0].env.filter("name:SERVICE_RELEASE").extract("value"))'
# ['c7d7c42abc5b5d0364735beaa89ecec0e85a3d51']
```

Write both down. The second is the SHA you will redeploy.

**Stop condition:** if the second command prints nothing, the revision predates
the environment contract and this drill will not tell you anything useful. Deploy
current `master` instead of a redeploy.

### 1.2 Start the deploy

```bash
export SHA=c7d7c42abc5b5d0364735beaa89ecec0e85a3d51   # what you noted above
gh workflow run "Deploy dev" --field sha="$SHA"
sleep 10
gh run list --workflow "Deploy dev" --limit 1 --json databaseId,status --jq '.[0]'
# {"databaseId":34015388348,"status":"in_progress"}
```

**Stop condition:** if the run does not appear, another deploy is already
running and holding the `deploy-dev` concurrency group. Wait for it — do not
cancel it; cancelling mid-migration leaves the database ahead of every running
revision.

### 1.3 Watch it

```bash
gh run watch "$(gh run list --workflow 'Deploy dev' --limit 1 --json databaseId --jq '.[0].databaseId')"
```

The steps run in this order, and each is the gate on the next:

| Step | What it proves |
| --- | --- |
| Copy the release image into Artifact Registry | the exact bytes CI tested exist where Cloud Run can read them |
| Migrate the dev database | the schema is ready **before** any new revision starts |
| Open the deployment record | GitHub knows a deploy is in flight |
| Deploy the revision | the new revision exists and carries the release label |
| Wait for readiness | it answers, and its database answers |
| Smoke test the public surface | content is actually served |
| Record the deployment result | GitHub knows how it ended |
| Summarise the deployment | the four coordinates and the log query land in the run summary |

**Stop condition:** a failure in "Migrate the dev database" leaves the running
revision untouched — the service is still healthy and you have not lost anything.
Go to [§3](#3-a-migration-failed). A failure after that means a revision was
created; go to [§5](#5-a-revision-will-not-stay-up).

### 1.4 Read the summary

```bash
gh run view "$(gh run list --workflow 'Deploy dev' --limit 1 --json databaseId --jq '.[0].databaseId')"
```

The job summary carries a table with Result, Release, Environment, Cloud Run
revision, Migration version, Image and Service URL, followed by the `gcloud
logging read` command scoped to that release. Copy that command; it is the one
you will want first in any later incident.

### 1.5 Verify

Run the checklist in
[20-deployment-observability.md §8](../20-deployment-observability.md#8-release-verification-checklist).
Every item, in order. The two that catch most problems:

```bash
curl -sS "$URL/v1/health/ready"
# {"status":"ok","checks":{"database":{"status":"up","latencyMs":9.728515}}}

gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=\"$SERVICE\" AND jsonPayload.release=\"$SHA\"" \
  --project "$PROJECT" --freshness 30m --limit 20 --order desc \
  --format='value(timestamp,jsonPayload.level,jsonPayload.event,jsonPayload.message)'
# 2026-09-06T10:48:59.797963Z  info  application_started  Country Flags backend started
```

### 1.6 Prove the release SHA finds everything

```bash
gh api repos/dudeinhoodie/country-flags/deployments \
  --jq ".[] | select(.sha==\"$SHA\") | {id, environment, created_at}" | head -5

gcloud run revisions list --service "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --filter="metadata.labels.release=$SHA" --format='value(metadata.name)'
```

**Stop condition:** the revision filter returns nothing for any revision created
before this labelling landed. That is expected on old revisions and a bug on new
ones; read `SERVICE_RELEASE` off the revision to tell which case you are in
(§1.1).

### 1.7 Finish

Nothing to undo — you redeployed what was already there. If you want the drill on
the record, note the run id and the revision it produced.

## 2. Rolling a release back

**Target: fifteen minutes.** A rollback is a deploy of an older immutable image,
not a rebuild and not a database change.

### 2.1 Decide whether to roll back at all

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=\"$SERVICE\" AND severity>=ERROR" \
  --project "$PROJECT" --freshness 2h --limit 20 --order asc \
  --format='value(timestamp,jsonPayload.release,jsonPayload.event,jsonPayload.message)'

gcloud run revisions list --service "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --sort-by='~metadata.creationTimestamp' --limit 5 \
  --format='table(metadata.name,metadata.labels.release,metadata.creationTimestamp)'
```

**Stop condition:** if the first error predates the newest revision, the release
is not the cause and a rollback will not help. Go to
[§6](#6-the-database-is-slow-or-refusing-connections) or
[§4](#4-readiness-is-failing) instead.

### 2.2 Check the older release can still read the schema

The database does not roll back. A revision that predates the last migration must
still be able to read the current schema.

```bash
gcloud run revisions describe <previous-revision> --region "$REGION" --project "$PROJECT" \
  --format='value(spec.containers[0].env.filter("name:MIGRATION_VERSION").extract("value"))'

find backend/prisma/migrations -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort | tail -3
# 20260905180000_store_sync_runs
# 20260905190000_deck_card_public_preview
```

If the revision's `MIGRATION_VERSION` is the newest migration, or the migrations
applied since it are additive, roll back.

**Stop condition:** if a destructive migration has run since that release — a
dropped column, a narrowed type — the old image cannot run against this schema.
Do not roll back. Fix forward, or restore
([10-backup-restore-runbook.md](../10-backup-restore-runbook.md)). This is why
§12 of the deployment spec separates a destructive migration from the release
that stops reading the old shape.

### 2.3 Roll back

Two ways. Prefer the first: it re-runs the whole gate.

```bash
# Redeploy a known-good SHA. Same workflow, same migration step, same smoke.
gh workflow run "Deploy dev" --field sha=<previous-good-sha>
```

```bash
# Faster, and skips every check: shift traffic to a revision that already exists.
gcloud run services update-traffic "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --to-revisions <previous-revision>=100
```

Use the second only when the first is failing too, and know what you gave up: no
migration step, no readiness gate, no smoke, and the next deploy will move
traffic back to the latest revision.

### 2.4 Verify and record

Run the checklist in
[20-deployment-observability.md §8](../20-deployment-observability.md#8-release-verification-checklist),
then leave a note on the issue or incident with: the bad SHA, the SHA you rolled
back to, the first bad log line and its timestamp.

**Unverified on production.** There is no `api-prod` service and no production
deploy workflow ([#39](https://github.com/dudeinhoodie/country-flags/issues/39),
[#301](https://github.com/dudeinhoodie/country-flags/issues/301)). §2.3's first
form will not exist for prod until that workflow does; the second will, because
`update-traffic` is a service-level operation.

## 3. A migration failed

The deploy stopped at "Migrate the dev database". **The running revision is
untouched and still serving.** You have time.

### 3.1 Read the failure

```bash
RUN=$(gh run list --workflow "Deploy dev" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run view "$RUN" --log-failed | grep -A 20 -i "migration\|prisma\|error" | head -40
```

Prisma names the migration it stopped on and whether it applied partially.

### 3.2 Find out where the database actually is

```bash
export DIRECT_DATABASE_URL="$(gcloud secrets versions access latest --secret=dev-direct-database-url --project "$PROJECT")"
export DATABASE_URL="$DIRECT_DATABASE_URL"
NODE_OPTIONS= corepack yarn workspace @country-flags/backend prisma migrate status
```

Expected when healthy, verbatim from dev on 6 September 2026:

```text
Datasource "db": PostgreSQL database "neondb", schema "public" at "ep-...aws.neon.tech"

20 migrations found in prisma/migrations

Database schema is up to date!
```

Three failure shapes, and what each means:

| What it says | What happened | What to do |
| --- | --- | --- |
| `Following migrations have not yet been applied` | the migration never started | fix the migration, redeploy |
| `The failed migration(s) can be resolved` | it started and stopped part-way | §3.3 |
| a connection error | the database is unreachable | [§6](#6-the-database-is-slow-or-refusing-connections); this is not a migration problem |

### 3.3 A partially applied migration

Prisma will not proceed until the failed entry is resolved. Two choices, and they
are not interchangeable:

```bash
# The migration made no changes at all: mark it rolled back and fix the SQL.
NODE_OPTIONS= corepack yarn workspace @country-flags/backend \
  prisma migrate resolve --rolled-back <migration_name>

# The changes are all present, applied by hand or by a partial run: mark it applied.
NODE_OPTIONS= corepack yarn workspace @country-flags/backend \
  prisma migrate resolve --applied <migration_name>
```

Before choosing, look at the schema. Guessing here writes a lie into
`_prisma_migrations` that the next deploy will believe.

**Stop conditions:**

- **Never write a down migration.** The project forbids them
  ([13-deployment-environments.md](../13-deployment-environments.md) §12). Recovery
  is forward-fix or restore.
- **If the migration dropped or rewrote data**, stop and restore rather than
  resolve: [10-backup-restore-runbook.md](../10-backup-restore-runbook.md).
- **If you cannot tell which of the two commands applies**, stop and restore. A
  wrong `resolve` is worse than an outage, because it is silent.

### 3.4 Redeploy

```bash
gh workflow run "Deploy dev" --field sha=<sha>
```

Then §1.5.

**Unverified on production.** The production path adds a pre-deploy backup gate
and a separate migration job that neither exists nor has been run.

## 4. Readiness is failing

Alert: *"readiness is failing"* or *"readiness is unreachable"*.

```bash
curl -sS -o /dev/null -w '%{http_code} in %{time_total}s\n' "$URL/v1/health/live"
curl -sS -w '\n%{http_code}\n' "$URL/v1/health/ready"
```

| What you get | What it means | Where to go |
| --- | --- | --- |
| live `200`, ready `200` | recovered, or a cold start expired the probe | check the alert window; on dev one slow probe is not an incident |
| live `200`, ready `503` | the process is up, the database is not | [§6](#6-the-database-is-slow-or-refusing-connections) |
| both time out | no instance is serving | [§5](#5-a-revision-will-not-stay-up) |
| live `200` slowly, then fine | dev woke from zero | not an incident |

```bash
gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --format='yaml(status.conditions,status.latestReadyRevisionName)'
```

Expected: `type: Ready, status: 'True'`.

**Stop condition:** if the service reports `Ready: True` and the outside probe
still fails, the fault is between the probe and the service. Check
[status.cloud.google.com](https://status.cloud.google.com/) before touching the
release.

## 5. A revision will not stay up

Alert: *"is restarting in a loop"*, or a deploy that never became ready.

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=\"$SERVICE\" AND jsonPayload.event=\"application_started\"" \
  --project "$PROJECT" --freshness 30m --limit 20 \
  --format='value(timestamp,jsonPayload.release,jsonPayload.deploymentId)'

gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=\"$SERVICE\" AND severity>=ERROR" \
  --project "$PROJECT" --freshness 30m --limit 50 --order asc
```

A process that fails configuration validation never reaches the JSON logger, so
its complaint arrives as `textPayload` rather than `jsonPayload`:

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=\"$SERVICE\"" \
  --project "$PROJECT" --freshness 30m --limit 50 --order desc \
  --format='value(timestamp,textPayload,jsonPayload.message)'
```

`Environment variable X is required` or `must be one of` means the deploy's
`--set-env-vars` or `--set-secrets` list lost something. The whole configuration
is written on every deploy, so the fix is in `deploy-dev.yml`, never in the
console — a console edit is overwritten by the next deploy.

**Stop conditions:**

- Every start reports the same release: the release is the cause.
  [§2](#2-rolling-a-release-back).
- The release changes between starts: two deploys are racing. Stop deploying and
  find out why the concurrency group let both through.
- On dev, starts spread across idle periods are scale-to-zero and not a loop.

## 6. The database is slow or refusing connections

Alert: *"database is under pressure"*.

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=\"$SERVICE\" AND jsonPayload.event=\"readiness_check_slow\"" \
  --project "$PROJECT" --freshness 2h --limit 20 \
  --format='value(timestamp,jsonPayload.latencyMs)'

gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=\"$SERVICE\" AND jsonPayload.errorClass=~\"^Prisma\"" \
  --project "$PROJECT" --freshness 2h --limit 30 \
  --format='value(timestamp,jsonPayload.event,jsonPayload.errorClass)'
```

| Error class | What it means | What to do |
| --- | --- | --- |
| `PrismaClientInitializationError` | the connection string or the pooler is wrong | check `dev-database-url`; waiting will not fix it |
| `PrismaClientKnownRequestError`, a few, around a deploy or a shutdown | the pool closing | not an incident |
| `PrismaClientKnownRequestError`, sustained | queries are failing | read the messages; this is application-level |
| a timeout, with `readiness_check_slow` climbing | the branch is waking, saturated, or the provider is degraded | Neon's console and [neonstatus.com](https://neonstatus.com/) |

Confirm from outside the API:

```bash
export DIRECT_DATABASE_URL="$(gcloud secrets versions access latest --secret=dev-direct-database-url --project "$PROJECT")"
export DATABASE_URL="$DIRECT_DATABASE_URL"
NODE_OPTIONS= corepack yarn workspace @country-flags/backend prisma migrate status
```

**Stop conditions:**

- Connection counts, storage and plan limits are not visible from this GCP
  project. If the API's own signals look fine and it is still failing, the answer
  is in Neon's console and nowhere else.
- Do not roll the release back for a database problem. Nothing in the image
  changes how much connection quota exists.

## 7. A worker backlog is not draining

Alert: *"worker backlog is not draining"* or *"worker stopped reporting"*. The
`queue` label on the incident says which of `analytics`, `learning`,
`reconciliation`, `scheduler-migration`.

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=\"$SERVICE\" AND jsonPayload.event=\"worker_backlog_snapshot\"" \
  --project "$PROJECT" --freshness 1h --limit 40 --order desc \
  --format='value(timestamp,jsonPayload.queue,jsonPayload.pending,jsonPayload.processing,jsonPayload.deadLetter,jsonPayload.oldestPendingAgeSeconds)'
```

Read two consecutive snapshots for the queue named in the alert.

| What the snapshots show | What it is | What to do |
| --- | --- | --- |
| `pending` falling | draining, slowly | nothing. Raise the threshold if it recurs |
| `pending` flat, `processing` above zero | items claimed and never finished — a lease that outlives the work | look for `*_poll_failed` below |
| `pending` flat, `processing` zero | the worker is not claiming | look for `*_poll_failed`; then restart |
| `deadLetter` rising | items exhausting their retries | look for `*_dead_lettered` |
| no snapshots at all for one queue | that worker is wedged | restart the revision |
| no snapshots for any queue | no instance is running | on dev, scale-to-zero; on prod, [§5](#5-a-revision-will-not-stay-up) |

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=\"$SERVICE\" AND jsonPayload.event=~\"_poll_failed$\"" \
  --project "$PROJECT" --freshness 1h --limit 30 \
  --format='value(timestamp,jsonPayload.event,jsonPayload.errorClass)'

gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=\"$SERVICE\" AND jsonPayload.event=~\"_dead_lettered$\"" \
  --project "$PROJECT" --freshness 24h --limit 30 \
  --format='value(timestamp,jsonPayload.event,jsonPayload.attemptCount,jsonPayload.errorClass)'
```

To restart the workers, restart the process — they run inside the API:

```bash
gcloud run services update "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --update-env-vars "WORKER_RESTART_AT=$(date -u +%Y%m%dT%H%M%SZ)"
```

That creates a new revision with the same image. Note that the next deploy
rewrites the environment wholesale and drops the marker, which is fine — it is a
nonce, not configuration.

**Stop conditions:**

- **Dead-lettered items are never retried and their count never falls on its
  own.** The alert stays firing until they are cleared, and clearing them is a
  deliberate decision about data, not a way to silence an alert. Read what they
  are first.
- **Do not restart to clear a backlog.** A restart releases leases; it does not
  fix whatever was failing, and it will look like recovery for one poll cycle.
- On dev, a queue that aged while the service was scaled to zero is expected.

## 8. A scheduled job stopped running

Alert: *"store reconciliation has not run"*, or nothing at all — a schedule that
stops firing produces no failed run to notice.

```bash
gh run list --workflow "Store reconciliation (dev)" --limit 10 \
  --json conclusion,createdAt --jq '.[] | "\(.createdAt) \(.conclusion)"'

gh run list --workflow "Backup restore drill" --limit 5 \
  --json conclusion,createdAt --jq '.[] | "\(.createdAt) \(.conclusion)"'
```

| What you see | What it is | What to do |
| --- | --- | --- |
| recent `success` runs | the sweeps happen; only the heartbeat write is failing | check `roles/logging.logWriter` on `github-deployer`. Not an incident |
| recent `failure` runs | the job runs and breaks | `gh run view <id> --log-failed` |
| no runs at all | GitHub disabled the schedule | scheduled workflows are switched off after sixty days of repository inactivity. Re-enable, then `gh workflow run` once by hand |

```bash
gh run view "$(gh run list --workflow 'Store reconciliation (dev)' --limit 1 --json databaseId --jq '.[0].databaseId')" --log-failed | tail -40
```

**Known, as of 6 September 2026:** this sweep fails on every hourly run. It stops
in "Read the credentials" because the `dev-commerce-apple-iap-*` secrets do not
exist in Secret Manager:

```bash
gcloud secrets list --project "$PROJECT" --format='value(name)' | grep commerce || echo "none"
```

Creating them is a product decision, not an operational one. See
[commerce-reconciliation-runbook.md](./commerce-reconciliation-runbook.md).

## 9. A backup or restore drill failed

The mechanics of backup, PITR and restore are in
[10-backup-restore-runbook.md](../10-backup-restore-runbook.md). This section is
only about noticing and triaging.

There is no cloud alert for this. The drill is a monthly GitHub Actions cron and
GitHub emails the repository owner when a scheduled workflow fails. That covers
"it ran and broke"; it does not cover "it stopped running" — for that, see
[§8](#8-a-scheduled-job-stopped-running).

```bash
gh run list --workflow "Backup restore drill" --limit 5 \
  --json conclusion,createdAt,databaseId --jq '.[] | "\(.createdAt) \(.conclusion) \(.databaseId)"'

gh run view <id> --log-failed | tail -40
```

The drill restores into a throwaway PostgreSQL service container inside the CI
job. It touches no production data, holds no cloud credentials, and cannot damage
anything — so a failure is safe to reproduce:

```bash
gh workflow run "Backup restore drill"
```

**Stop conditions:**

- A failing drill means the restore procedure is unproven, not that a backup is
  lost. Do not treat it as an outage, and do not skip fixing it: an unproven
  restore is the RTO target being fiction.
- Never restore into `country-flags-dev` or a production database to test a
  backup. The drill exists so that restoring never has to be rehearsed on
  something real.

**Known, as of 6 September 2026:** the last drill ran on 1 September 2026 and
failed. It has not been diagnosed here.

**Unverified on production.** The pre-deploy production backup gate, the private
backup bucket and its retention policy are specified
([13-deployment-environments.md](../13-deployment-environments.md) §16) and do not
exist.

## 10. Rotating a secret

Every runtime secret lives in Secret Manager and is mounted by version alias
`:latest`. A rotation is therefore two acts: a new version, then a deploy. The
value never passes through this repository, a laptop, or a GitHub secret.

```bash
gcloud secrets list --project "$PROJECT" --format='value(name)'
# dev-account-data-hash-secret
# dev-admin-draft-storage-access-key-id
# ...
```

### 10.1 Add a version

For a secret with no external source — the three auth secrets — generate it:

```bash
printf %s "$(openssl rand -hex 32)" \
  | gcloud secrets versions add dev-auth-access-token-secret --data-file=- --project "$PROJECT"
```

For one that mirrors a provider credential — database URLs, storage HMAC keys,
the admin GitHub token — rotate it at the provider first, then add the new value:

```bash
gcloud secrets versions add dev-database-url --data-file=- --project "$PROJECT"
# paste the value, then Ctrl-D
```

Never `echo` a secret into a shell that records history, and never pass it as a
command-line argument: `--data-file=-` and a heredoc are the whole reason those
flags exist.

```bash
gcloud secrets versions list dev-auth-access-token-secret --project "$PROJECT" \
  --format='table(name,state,createTime)'
# 4  ENABLED   2026-09-06T11:02:00
# 3  ENABLED   2026-08-11T13:40:00
```

### 10.2 Make the revision pick it up

`:latest` is resolved when a revision starts, not continuously. A new secret
version changes nothing until a new revision exists:

```bash
gh workflow run "Deploy dev" --field sha="$SHA"
```

Then §1.5.

### 10.3 Retire the old version

Only after the new revision is serving and verified. Disable first — it is
reversible; destroy is not.

```bash
gcloud secrets versions disable <old-version> --secret=dev-auth-access-token-secret --project "$PROJECT"
# wait until you are confident, then:
gcloud secrets versions destroy <old-version> --secret=dev-auth-access-token-secret --project "$PROJECT"
```

**Stop conditions, per secret:**

| Secret | What breaks the moment the new version is live |
| --- | --- |
| `dev-auth-access-token-secret` | every issued access token stops validating; all clients must sign in again |
| `dev-auth-rate-limit-secret` | rate-limit buckets are re-keyed; counters reset once |
| `dev-account-data-hash-secret` | **do not rotate casually** — hashes already stored were derived from the old value and will not match |
| `dev-database-url`, `dev-direct-database-url` | the old credential must stay valid until the new revision is serving, or the running one loses its database |
| `dev-admin-draft-storage-*`, `dev-object-storage-*` | uploads and publishes fail until the deploy lands |
| `dev-content-signing-private-key` | a new key needs a new `keyId` in `dev-content-signing-public-keys` **and** the old public key kept, or already-published bundles stop verifying |
| `dev-admin-github-token` | console proposals and publish dispatches fail |

- **Rotate one secret at a time**, and verify between. Two at once makes a
  failure ambiguous.
- **Never destroy the previous version in the same session as the rotation.** If
  the deploy has to be rolled back, the old revision needs the old value.
- If a secret leaked, disabling the old version is the urgent act, and it is
  urgent *after* the new revision is serving — not before, or you cause the
  outage yourself.

**Unverified on production.** No production secrets exist. The procedure is the
same; the blast radius is not.

## 11. Production

There is no `api-prod` service, no production deploy workflow, no production
database and no production backup bucket
([#39](https://github.com/dudeinhoodie/country-flags/issues/39),
[#301](https://github.com/dudeinhoodie/country-flags/issues/301)).

Everything above has been run against dev. For production, these are specified
and have never been executed by anyone:

- promotion of an existing image by `workflow_dispatch`, gated on the image
  having passed dev ([13-deployment-environments.md](../13-deployment-environments.md) §11);
- the pre-deploy backup gate, and a production migration as its own job (§11, §16);
- `deploy-production` concurrency without cancel-in-progress (§11);
- the fifteen-minute application rollback target against an always-on service (§15);
- the monthly restore drill into an isolated temporary database (§16).

When that workflow lands, this file needs: `SERVICE=api-prod` in §0, the backup
gate as a step in §1, and the stop conditions in §2.2 restated for a database
with real user data — where "fix forward" and "restore" carry a cost that dev
does not have.
