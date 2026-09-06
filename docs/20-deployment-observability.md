# Deployment Observability

Status: `Implementation baseline 0.1`
Date: 6 September 2026
Sources: [13-deployment-environments.md](./13-deployment-environments.md) §17,
[14-deployment-agent-handoff.md](./14-deployment-agent-handoff.md) DPL-6,
[06-observability-analytics.md](./06-observability-analytics.md)
Tracking: [GitHub issue #41](https://github.com/dudeinhoodie/country-flags/issues/41)

What one operator, with no observability product of their own, can see about a
deployment, a degraded worker and a recovery. The runbooks that act on what this
document describes are in
[ops/deployment-runbooks.md](./ops/deployment-runbooks.md); the machine-readable
definitions are in [`infrastructure/monitoring/`](../infrastructure/monitoring).

## 1. What actually exists

Read this before anything below, because half of what §17 asks for is written
against an environment that does not run yet.

| | dev | prod |
| --- | --- | --- |
| Cloud Run service | `api-dev`, `admin-dev`, live | none |
| Deploy workflow | `.github/workflows/deploy-dev.yml` | **none** — issues [#39](https://github.com/dudeinhoodie/country-flags/issues/39), [#301](https://github.com/dudeinhoodie/country-flags/issues/301) |
| Database | Neon `country-flags-dev` | none |
| Alert policies | none until the owner applies them | none |
| OTLP collector | none | none |

Everything in this document has been exercised against dev. Nothing has been
exercised against prod, because there is nothing to exercise it against. Where a
procedure could not be verified, it says so in place rather than reading as
though it had been rehearsed.

## 2. The signals

Five, kept separate on purpose (§1 of the observability spec). This document
covers the three that a deployment is watched through.

### 2.1 Logs

One JSON object per line on stdout, stderr for `error` and `fatal`. Cloud Run
parses it into `jsonPayload`, which is what makes every field below queryable.

Every line carries, from `backend/src/common/logging/json-logger.service.ts`:

| Field | Source | Example |
| --- | --- | --- |
| `service` | `SERVICE_NAME` | `country-flags-api` |
| `environment` | `DEPLOYMENT_ENV` | `dev` |
| `release` | `SERVICE_RELEASE` | `c7d7c42abc5b5d0364735beaa89ecec0e85a3d51` |
| `deploymentId` | `DEPLOYMENT_ID`, else Cloud Run's `K_REVISION` | `api-dev-00127-nmd` |
| `migrationVersion` | `MIGRATION_VERSION`, set by the deploy | `20260901120000_add_entitlements` |
| `level`, `timestamp`, `message` | the call site | |
| `traceId`, `spanId` | the active span, when one exists | |

`deploymentId` and `migrationVersion` are omitted rather than defaulted when
nothing supplies them, so a local line keeps its old shape and a hosted line is
never labelled with a rollout that does not exist.

`environment` is the deployment environment and not `NODE_ENV`: dev and prod run
the same production build, so `NODE_ENV` cannot tell their logs apart. That is
the field that keeps dev and prod telemetry separable, and it is why every alert
filter and dashboard widget in `infrastructure/monitoring/` names it.

### 2.2 Traces and metrics

OpenTelemetry, pushed over OTLP. The resource carries `service.name`,
`service.version` (the release SHA), `deployment.environment.name`,
`deployment.id` and `country_flags.migration.version` — the same five facts the
logs carry, under the semantic-convention names.

**Nothing receives them today.** `OTEL_ENABLED` is unset on every hosted
revision, and no collector is deployed. `@opentelemetry/api` is a no-op without a
registered SDK, so this costs nothing and breaks nothing; it means the metrics in
`backend/src/common/telemetry/metrics.service.ts` are real code with no reader.
That is why the alerts in §5 are written against logs.

An unreachable collector cannot take the API down: `bootstrapTelemetry` runs
before Nest and now catches a failing start, writes one line to stderr, and
continues without export.

### 2.3 GitHub

Independent of any provider, which is the point (§17). For each dev deploy:

- a deployment record on the commit, with the environment, the service URL, the
  image reference and the migration version in its payload;
- a status of `in_progress` and then `success` or `failure` — the record is
  opened before the revision changes, so a deploy that never became ready stops
  reporting itself as a success;
- a job summary carrying the release, the revision, the migration version, the
  image digest and the log query for that release.

## 3. Finding a deployment from a release SHA

The acceptance question. Four answers, from four independent stores; if one is
down the others still answer.

```bash
SHA=c7d7c42abc5b5d0364735beaa89ecec0e85a3d51

# 1. The deployment: who deployed it, when, and whether it worked.
gh api repos/dudeinhoodie/country-flags/deployments \
  --jq ".[] | select(.sha==\"$SHA\") | {id, environment, created_at, payload}"

# 2. The revision it became.
gcloud run revisions list --service api-dev --region europe-west3 \
  --filter="metadata.labels.release=$SHA" \
  --format='table(metadata.name,metadata.creationTimestamp,status.conditions[0].status)'

# 3. Its logs.
gcloud logging read \
  "resource.type=cloud_run_revision AND jsonPayload.release=\"$SHA\"" \
  --project speedy-web-235610 --freshness 1d --limit 50 --order desc \
  --format='value(timestamp,jsonPayload.level,jsonPayload.event,jsonPayload.message)'

# 4. Its errors.
gcloud logging read \
  "resource.type=cloud_run_revision AND jsonPayload.release=\"$SHA\" AND severity>=ERROR" \
  --project speedy-web-235610 --freshness 1d --limit 50 --order desc
```

Query 3 against the release deployed on 6 September 2026 returns, verbatim:

```text
2026-09-06T10:48:59.797963Z  info  application_started  Country Flags backend started
```

Query 2 returns nothing for revisions created before this change landed: the
`release` label is written by the deploy workflow, and revisions older than it
have no labels. For those, read the environment variable instead:

```bash
gcloud run revisions describe api-dev-00127-nmd --region europe-west3 \
  --format='value(spec.containers[0].env.filter("name:SERVICE_RELEASE").extract("value"))'
# ['c7d7c42abc5b5d0364735beaa89ecec0e85a3d51']
```

Traces are found by `service.version` on the resource, and errors by the same
`release` field, once an OTLP collector exists.

## 4. Queries, without the provider

The provider owns the syntax; it does not own the question. Each row is the same
question in three dialects, so leaving Cloud Logging costs a rewrite and not a
redesign.

| Question | Cloud Logging / Monitoring | PromQL | Generic |
| --- | --- | --- | --- |
| Everything one release said | `jsonPayload.release="<sha>"` | `{release="<sha>"}` | filter on the release attribute |
| Only this environment | `jsonPayload.environment="dev"` | `{deployment_environment_name="dev"}` | filter on the environment attribute |
| Error rate | `metric.type="run.googleapis.com/request_count" metric.label.response_code_class="5xx"` over the same without the class | `sum(rate(http_requests_total{statusClass="5xx"}[5m])) / sum(rate(http_requests_total[5m]))` | 5xx count ÷ total count |
| p95 latency | `run.googleapis.com/request_latencies`, `ALIGN_PERCENTILE_95` | `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_ms_bucket[5m])))` | 95th percentile of request duration |
| Queue lag | `logging.googleapis.com/user/api_worker_oldest_pending_age_seconds` by `queue` | `max by (queue) (outbox_oldest_pending_age_seconds)` | oldest unfinished item per queue |
| Queue depth | `jsonPayload.event="worker_backlog_snapshot"`, read `pending` | `max by (queue) (outbox_depth)` | pending items per queue |
| Dead letters | `logging.googleapis.com/user/api_worker_dead_letter_depth` by `queue` | `max by (queue) (outbox_dead_letter_depth)` | items past their last retry |
| Worker still alive | absence of `api_worker_backlog_heartbeat` | `absent_over_time(outbox_depth[15m])` | no report for 15 minutes |
| Deployments | `jsonPayload.event="application_started"` by `release` | `changes(process_start_time_seconds[1h])` | process starts grouped by release |
| Store sweeps | absence of `api_store_reconciliation_finished` | `absent_over_time(store_reconciliation_runs_total[26h])` | no completed sweep for a day |

The dashboard in `infrastructure/monitoring/dashboard.json` draws the first
eight of these in one screen, in the order an operator asks them: is it up, is it
erroring, is it slow, are the queues moving, what released and when.

## 5. Alerts

Defined in `infrastructure/monitoring/alert-policies/`, applied by the owner with
`infrastructure/monitoring/apply.sh`. **None of them exist in the project yet** —
the project has no alert policies and no notification channels at all.

| Alert | Fires when | Severity | Notes |
| --- | --- | --- | --- |
| Readiness is failing | `/v1/health/ready` returned 503 in the last 5 min | critical | from the API's own log |
| Readiness is unreachable | the external probe failed for 10 min | critical | needs the uptime check; catches "no instance running" |
| Sustained 5xx | 5xx share above 5% for 10 min | critical | a ratio, so a quiet night with two errors does not page |
| Restart loop | more than 6 process starts in 10 min | error | **not enabled on dev** — scale-to-zero makes starts normal |
| Database under pressure | readiness p95 over 500 ms, or Prisma errors over 6/min | warning | half the signal; see below |
| Worker backlog not draining | oldest pending item older than 15 min, or over 10 dead letters | error | per `queue` |
| Worker stopped reporting | no backlog heartbeat for 15 min | error | the failure the lag alert cannot see |
| Store reconciliation stalled | no completed sweep for 26 h | warning | needs the heartbeat write; see §7 |

Backup and restore-drill failure is not a Cloud Monitoring alert. The drill is a
monthly GitHub Actions cron, and GitHub emails the repository owner when a
scheduled workflow fails — that is the channel. What it does not cover is a
schedule that stopped firing; §7 says what to do about that.

**Only half of the database signal is ours.** Connection counts, storage and plan
limits belong to Neon and are not visible from this GCP project. Our half is the
readiness probe latency and the Prisma error rate. The other half is an alert
configured in Neon's own console, and it has not been configured.

### Why the alerts read logs

The OTLP metrics are the primary signal and are correct. But nothing receives
them (§2.2), so an alert written against them would never fire. The same code
also writes a structured log line carrying the same numbers, and those arrive.
When a collector is deployed the alerts can be rewritten against the metrics
without changing what any of them mean.

## 6. What an alert may carry

Rule: an alert notification may contain the policy name, the condition, the
runbook text written into the policy, and metric labels. It may not contain log
message bodies, request paths, request or user identifiers, or any credential.

Every label used by every metric in `log-metrics.json`:

```text
environment  dev | prod
queue        analytics | learning | reconciliation | scheduler-migration
release      a git SHA
error_class  an exception class name
service_name api-dev | api-prod
response_code_class  2xx | 3xx | 4xx | 5xx
```

Each is an enum, a queue name, a class name or a commit — none is user-supplied.
Nothing uses `EXTRACT` on a message body or a path.

Underneath, the logger redacts before anything is written at all:
`backend/src/common/logging/redaction.ts` replaces values under keys matching
tokens, passwords, secrets, authorization, cookies, email, provider subject, push
tokens, IDFA, private keys and signed payloads, and rewrites anything shaped like
a JWT, a bearer header or an email address wherever it appears. Held by
`redaction.spec.ts` and by a case in `json-logger.service.spec.ts` that smuggles
an email and an access token into a line beside the deployment fields and asserts
both come out redacted.

The cardinality rule from the observability spec §9 also holds here: no metric
label is a user ID, a request ID, an entity UUID, a raw URL or free-form error
text.

## 7. Worker signals, and what they could not answer before

Four polling workers run inside the API process. Every one of them now reports
`pending`, `processing`, `deadLetter` and the age of the oldest unfinished item,
once a minute per queue, as both a metric and a log line.

| Queue | Worker | What "oldest pending age" means |
| --- | --- | --- |
| `analytics` | `AnalyticsOutboxWorker` | oldest undelivered analytics event |
| `learning` | `LearningOutboxWorker` | oldest unpublished learning event |
| `reconciliation` | `ReconciliationWorker` | oldest unreconciled card job |
| `scheduler-migration` | `SchedulerMigrationWorker` | time since the run last advanced |

The last is deliberately different. A migration run over millions of card states
is legitimately old; only a run that stopped moving is worth an alert, and
`updatedAt` is written on every poll that claims a run.

What was missing before this document's change, and why each mattered:

- **Three of the four queues emitted nothing at all.** Only `analytics` reached a
  metric. A learning outbox, a reconciliation queue or a scheduler migration that
  stopped draining was visible to nobody but the user waiting on it. All four
  computed the numbers already — nothing read them.
- **Dead-letter depth was computed and discarded**, in all four. Items past their
  last retry stop aging, so they vanish from both depth and lag: the one state
  that never recovers on its own was the one state with no signal. §14 of the
  deployment spec asks for exactly this and it was not there.
- **Absence was unalertable.** A worker that stops running fails nothing, logs
  nothing and has no backlog to be old. The heartbeat is emitted for a healthy,
  idle queue too, precisely so that its absence means something.

Two store-commerce signals were checked and are correct as they stand:
`recordStoreReconciliation` counts sweeps by outcome and times them, and
`recordStoreNotification` counts notifications by outcome. Both are the right
shape and the §17.1 alerts are written against absence rather than failure, which
is right: a sweep that stops being scheduled fails nothing.

They have one problem that is not about the metric. The sweep runs on a GitHub
runner, so everything it emits stays in GitHub and never reaches Cloud Logging —
an absence alert had nothing to be absent from. `commerce-reconciliation.yml` now
writes one line into Cloud Logging after a successful sweep. That write needs
`roles/logging.logWriter` on `github-deployer`, which the service account does
not have; without it the sweep still works and the step emits a warning instead
of failing.

**As of 6 September 2026 that sweep is failing on every hourly run** — the
`dev-commerce-apple-iap-*` secrets it reads do not exist in Secret Manager. The
alert defined here would have caught it on the first day. It is out of scope for
this document and needs its own issue.

## 8. Release verification checklist

Run after every dev deploy. Each step names what it should print; anything else
is the stop condition.

```bash
SERVICE=api-dev
REGION=europe-west3
PROJECT=speedy-web-235610
URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format='value(status.url)')"
```

- [ ] **The workflow finished.** `gh run list --workflow "Deploy dev" --limit 1`
      shows `success`.
- [ ] **The deployment was recorded.**
      `gh api repos/dudeinhoodie/country-flags/deployments --jq '.[0] | {sha, environment}'`
      names the commit you expect and `dev`.
- [ ] **The revision is serving the release you think it is.**
      `gcloud run revisions list --service "$SERVICE" --region "$REGION" --filter="metadata.labels.release=$SHA" --format='value(metadata.name)'`
      returns exactly one revision, and it is the latest ready one.
- [ ] **Liveness answers.** `curl -sS -o /dev/null -w '%{http_code}\n' "$URL/v1/health/live"`
      prints `200`. On dev the first call after an idle period takes several
      seconds; that is scale-to-zero, not a fault.
- [ ] **Readiness answers, and the database is quick.**
      `curl -sS "$URL/v1/health/ready"` prints
      `{"status":"ok","checks":{"database":{"status":"up","latencyMs":9.7...}}}`.
      A `latencyMs` over 250 also writes a `readiness_check_slow` log line.
- [ ] **Content is served.**
      `curl -sS -o /dev/null -w '%{http_code}\n' "$URL/v1/content/manifest?locale=en"`
      prints `200`, or `404` when no release has been published to this
      environment yet — a working API with no content, not a broken one.
- [ ] **A protected route still refuses.**
      `curl -sS -o /dev/null -w '%{http_code}\n' "$URL/v1/me"` prints `401`.
- [ ] **The process started once, not repeatedly.**
      `gcloud logging read 'resource.labels.service_name="'"$SERVICE"'" AND jsonPayload.event="application_started"' --project "$PROJECT" --freshness 30m --format='value(timestamp,jsonPayload.release,jsonPayload.deploymentId,jsonPayload.migrationVersion)'`
      shows one start per revision, carrying the release and the migration you
      deployed.
- [ ] **Nothing is erroring.**
      `gcloud logging read 'resource.labels.service_name="'"$SERVICE"'" AND severity>=ERROR' --project "$PROJECT" --freshness 30m --limit 20`
      is empty.
- [ ] **Every queue reported.**
      `gcloud logging read 'resource.labels.service_name="'"$SERVICE"'" AND jsonPayload.event="worker_backlog_snapshot"' --project "$PROJECT" --freshness 15m --format='value(jsonPayload.queue,jsonPayload.pending,jsonPayload.deadLetter,jsonPayload.oldestPendingAgeSeconds)'`
      lists all four queues. On dev, a service that has scaled to zero reports
      none of them, and that is expected — wake it with a request first.

## 9. Escalation

There is one operator and no on-call rotation; naming one would be fiction. What
this section gives instead is where to look when the fault is not ours.

| Provider | What it carries | Status |
| --- | --- | --- |
| Google Cloud Run, Logging, Monitoring, Artifact Registry, Secret Manager | runtime, logs, alerts, images, secrets | [status.cloud.google.com](https://status.cloud.google.com/) |
| Neon | PostgreSQL, dev and prod projects | [neonstatus.com](https://neonstatus.com/) |
| GitHub | CI, release images, deployment records, scheduled jobs | [githubstatus.com](https://www.githubstatus.com/) |
| Apple | App Store Server API, store notifications | [developer.apple.com/system-status](https://developer.apple.com/system-status/) |

Order of escalation, and the reason for it:

1. **Is it the release?** Compare the first bad log line against the deployment
   time. If the errors began within fifteen minutes of a new revision, roll back
   before investigating further — the runbook's rollback takes minutes and buys
   the time to look properly.
2. **Is it the database?** Readiness fails, or Prisma errors climb, while the
   revision is unchanged. Neon's status page and its own console answer this;
   nothing on our side will.
3. **Is it the provider?** The service reports ready and the outside probe
   disagrees, or several unrelated signals fail at once. Check the status page
   before touching anything.
4. **Is it us?** Everything else. The runbooks in
   [ops/deployment-runbooks.md](./ops/deployment-runbooks.md).

An alerting or provider outage must never reach the API. Telemetry export is a
no-op without a configured endpoint, a failing SDK start is caught, a failing
metric write inside a worker is swallowed, and no request path depends on any of
it.

## 10. What is not verified

- **Every production procedure.** There is no `api-prod` service and no
  production deploy workflow (issues #39 and #301). Production promotion,
  production rollback, the pre-deploy backup gate and the production migration
  runbook are written from the specification, not from a rehearsal, and each says
  so where it appears.
- **The alerts have never fired**, because they have never been created. The
  definitions are validated against the provider's API schema and `apply.sh` has
  been dry-run against the live dev project; nothing has been applied.
- **The restore drill last ran on 1 September 2026 and failed.** See
  [10-backup-restore-runbook.md](./10-backup-restore-runbook.md); it is not
  addressed here.
- **`LOG_LEVEL` has no runtime effect.** It is validated and set on the revision,
  but `JsonLoggerService` writes every level unconditionally. Turning it down
  will not reduce log volume and turning it up will not reveal more.
- **No auto-instrumentation is registered**, so there are no database or
  outbound-HTTP spans — only one manual span per request. A trace shows where a
  request went in our code and not what it waited on.
