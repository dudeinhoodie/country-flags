# Monitoring definitions

Alerts, log-based metrics, one uptime check and one dashboard, as files. Nothing
in this repository applies them: they change billable cloud resources, so the
project owner runs `./apply.sh` by hand, one environment at a time.

Read [`docs/20-deployment-observability.md`](../../docs/20-deployment-observability.md)
for what each signal means and why it is shaped this way. Read
[`docs/ops/deployment-runbooks.md`](../../docs/ops/deployment-runbooks.md) for
what to do when one of these fires — every policy's `documentation` field points
at the section that answers it.

## What is here

| File | What it defines |
| --- | --- |
| `log-metrics.json` | Eight log-based metrics derived from the API's structured logs. |
| `alert-policies/*.json` | One alert policy each. |
| `dashboard.json` | One screen: traffic, errors, latency, queues, releases. |
| `apply.sh` | Creates or updates all of the above, plus the readiness uptime check. Dry run unless `--apply`. |

The uptime check has no file of its own: `gcloud monitoring uptime create` takes
flags rather than a config file, and one definition written twice is one
definition that goes stale. It lives in `apply.sh`, in the "Uptime check"
section.

Every file is a template. `apply.sh` substitutes `${PROJECT_ID}`,
`${DEPLOYMENT_ENV}`, `${SERVICE_NAME}`, `${SERVICE_HOST}`,
`${NOTIFICATION_CHANNEL}` and `${UPTIME_CHECK_ID}`, so one set of definitions
serves dev and prod and every filter is forced to name its environment. That is
what keeps a dev incident off a prod dashboard and back.

## Why the alerts read logs rather than the OpenTelemetry metrics

`backend/src/common/telemetry/metrics.service.ts` emits real OTLP metrics, and
they are the primary signal. But no OTLP collector is deployed — `OTEL_ENABLED`
is not set on any hosted revision — so nothing receives them, and an alert
written against them would be an alert that never fires.

The same code also writes a structured log line for each of these signals, and
those arrive. So the alertable copy of the signal is derived from logs. If a
collector is deployed later, these definitions stay valid; the alerts can be
rewritten against the OTLP metrics without changing what any of them mean.

## Before the first run

Two things must exist first, and only the owner can create them.

**1. A notification channel.** A policy with no channel notifies nobody, so
`apply.sh` refuses to run without one.

```bash
gcloud beta monitoring channels create \
  --display-name="Country Flags owner" \
  --type=email \
  --channel-labels=email_address=<address> \
  --project speedy-web-235610

gcloud beta monitoring channels list \
  --project speedy-web-235610 --format='value(name,displayName)'
```

**2. `roles/logging.logWriter` on `github-deployer`**, so the hourly store
reconciliation can record that it ran. Without it the sweeps still happen and
still work; only the "reconciliation has not run" alert stays blind, and the
workflow says so in a warning annotation rather than failing.

```bash
gcloud projects add-iam-policy-binding speedy-web-235610 \
  --member=serviceAccount:github-deployer@speedy-web-235610.iam.gserviceaccount.com \
  --role=roles/logging.logWriter
```

## Running it

```bash
./apply.sh --env dev --channel projects/speedy-web-235610/notificationChannels/<id>
```

That prints every command it would run and writes nothing. Read it, then:

```bash
./apply.sh --env dev --channel projects/speedy-web-235610/notificationChannels/<id> --apply
```

It is idempotent. A metric, policy or dashboard that already exists is updated
rather than duplicated, so re-running after a failed half-run is safe.

`--env prod` is the same command against `api-prod`. It will fail until that
service exists — there is no production deploy workflow yet (issues #39 and
#301), so nothing here has been exercised against prod.

## Removing them

```bash
gcloud monitoring policies list --project speedy-web-235610 \
  --filter='userLabels.source="infrastructure-monitoring"' --format='value(name)' \
  | xargs -n1 gcloud monitoring policies delete --quiet --project speedy-web-235610
```

Log-based metrics and the dashboard are deleted with
`gcloud logging metrics delete <name>` and
`gcloud monitoring dashboards delete <name>`.

## What an alert notification contains

The policy name, the condition that fired, the `documentation` text above, and
the metric labels: `environment`, `queue`, `release`, `error_class`,
`service_name`, `response_code_class`. Nothing extracts a log message body, a
request path, a user identifier or a credential — see
`docs/20-deployment-observability.md` section 6 for the rule and the test that
holds it.

## Cost

Log-based metrics are billed on the log volume they scan, which is already being
ingested; the uptime check is free below one million checks a month, and one
check every five minutes is about nine thousand. Alert policies and dashboards
are free. The one thing that would cost is raising log verbosity, which is why
the worker heartbeat is throttled to one line a minute per queue rather than one
per poll.
