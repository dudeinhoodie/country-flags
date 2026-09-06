#!/usr/bin/env bash
#
# Creates or updates the log-based metrics, uptime check, alert policies and
# dashboard in this directory.
#
# Nothing in this repository runs this. It changes billable cloud resources, so
# it is run by hand, by the project owner, against one environment at a time. It
# prints what it would do and stops unless --apply is passed.
#
#   ./apply.sh --env dev --channel projects/speedy-web-235610/notificationChannels/123
#   ./apply.sh --env dev --channel projects/... --apply
#
# It is idempotent: anything that already exists is updated rather than
# duplicated, so re-running it after a failed half-run is safe.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ID="${PROJECT_ID:-speedy-web-235610}"
REGION="${REGION:-europe-west3}"
DEPLOYMENT_ENV=""
NOTIFICATION_CHANNEL=""
APPLY="false"

usage() {
  cat <<'USAGE'
Usage: apply.sh --env dev|prod --channel <notification channel resource name> [--apply]

  --env      Which deployment this is for. Selects the Cloud Run service
             (api-dev / api-prod) and the environment label every filter carries,
             which is what keeps dev alerts off prod dashboards and back.
  --channel  Full resource name of an existing notification channel, e.g.
             projects/<project>/notificationChannels/1234567890. Create one first:
               gcloud beta monitoring channels create \
                 --display-name="Owner email" --type=email \
                 --channel-labels=email_address=<address>
             Then list them with:
               gcloud beta monitoring channels list --format='value(name,displayName)'
  --apply    Actually write. Without it this is a dry run and nothing is created.

Environment overrides: PROJECT_ID (default speedy-web-235610), REGION (europe-west3).
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env) DEPLOYMENT_ENV="${2:-}"; shift 2 ;;
    --channel) NOTIFICATION_CHANNEL="${2:-}"; shift 2 ;;
    --apply) APPLY="true"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "${DEPLOYMENT_ENV}" in
  dev|prod) ;;
  *) echo "--env must be dev or prod" >&2; exit 2 ;;
esac

if [ -z "${NOTIFICATION_CHANNEL}" ]; then
  # A policy with no channel is a policy nobody hears. Refused rather than
  # created quietly, because a silent alert is worse than a missing one: it
  # looks like coverage.
  echo "--channel is required. An alert policy with no notification channel notifies nobody." >&2
  exit 2
fi

command -v gcloud >/dev/null 2>&1 || { echo "gcloud is required" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 1; }

SERVICE_NAME="api-${DEPLOYMENT_ENV}"
UPTIME_DISPLAY="${SERVICE_NAME} readiness"
UPTIME_CHECK_ID=""

SERVICE_HOST="$(
  gcloud run services describe "${SERVICE_NAME}" \
    --region "${REGION}" --project "${PROJECT_ID}" \
    --format='value(status.url)' 2>/dev/null | sed -e 's#^https://##' -e 's#/$##' || true
)"
if [ -z "${SERVICE_HOST}" ]; then
  echo "Cloud Run service ${SERVICE_NAME} does not exist in ${REGION}." >&2
  echo "See docs/13-deployment-environments.md section 6.1 for the one-time provisioning." >&2
  exit 1
fi

echo "Project:     ${PROJECT_ID}"
echo "Environment: ${DEPLOYMENT_ENV}"
echo "Service:     ${SERVICE_NAME}"
echo "Host:        ${SERVICE_HOST}"
echo "Channel:     ${NOTIFICATION_CHANNEL}"
echo "Mode:        $([ "${APPLY}" = "true" ] && echo APPLY || echo "dry run (pass --apply to write)")"
echo

run() {
  if [ "${APPLY}" = "true" ]; then
    "$@"
  else
    printf '  would run:'
    printf ' %q' "$@"
    printf '\n'
  fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

# Every definition is a template so that one set of files serves dev and prod
# and no filter can forget to name its environment.
substitute() {
  python3 - "$1" "$2" "${PROJECT_ID}" "${DEPLOYMENT_ENV}" "${SERVICE_NAME}" \
    "${SERVICE_HOST}" "${NOTIFICATION_CHANNEL}" "${UPTIME_CHECK_ID}" <<'PY'
import json, pathlib, sys

source, target = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
values = {
    "PROJECT_ID": sys.argv[3],
    "DEPLOYMENT_ENV": sys.argv[4],
    "SERVICE_NAME": sys.argv[5],
    "SERVICE_HOST": sys.argv[6],
    "NOTIFICATION_CHANNEL": sys.argv[7],
    "UPTIME_CHECK_ID": sys.argv[8],
}
text = source.read_text()
for key, value in values.items():
    text = text.replace("${" + key + "}", value)
document = json.loads(text)
document.pop("$comment", None)
target.write_text(json.dumps(document, indent=2))
PY
}

display_name_of() {
  python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["displayName"])' "$1"
}

# ---------------------------------------------------------------------------
# 1. Log-based metrics
# ---------------------------------------------------------------------------
echo "== Log-based metrics =="
python3 - "${HERE}/log-metrics.json" "${WORK}" <<'PY'
import json, pathlib, sys

source, workdir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
document = json.loads(source.read_text())
names = []
for metric in document["metrics"]:
    body = {key: value for key, value in metric.items() if not key.startswith("$")}
    names.append(body["name"])
    (workdir / f"metric-{body['name']}.json").write_text(json.dumps(body, indent=2))
# Trailing newline on purpose: `read` drops a final line that has none, and the
# metric that went missing would be the last one defined.
(workdir / "metric-names.txt").write_text("".join(f"{name}\n" for name in names))
PY

while IFS= read -r metric; do
  [ -n "${metric}" ] || continue
  if gcloud logging metrics describe "${metric}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    echo "- ${metric}: exists, updating"
    run gcloud logging metrics update "${metric}" \
      --config-from-file="${WORK}/metric-${metric}.json" \
      --project "${PROJECT_ID}"
  else
    echo "- ${metric}: creating"
    run gcloud logging metrics create "${metric}" \
      --config-from-file="${WORK}/metric-${metric}.json" \
      --project "${PROJECT_ID}"
  fi
done < "${WORK}/metric-names.txt"
echo

# ---------------------------------------------------------------------------
# 2. Uptime check
#
# Nothing else polls readiness between deploys: the Cloud Run startup probe is a
# TCP connect, and no HTTP check runs after the deploy workflow finishes. Without
# this, a database that becomes unreachable an hour after a deploy is discovered
# by the first user to open a deck.
#
# Five minutes rather than one because dev scales to zero and every probe would
# otherwise pay a cold start. Three regions is the provider's minimum. The probe
# sends no credentials and reads a body containing a status and a latency,
# nothing else.
# ---------------------------------------------------------------------------
echo "== Uptime check =="
UPTIME_NAME="$(
  gcloud monitoring uptime list-configs --project "${PROJECT_ID}" \
    --filter="displayName='${UPTIME_DISPLAY}'" --format='value(name)' 2>/dev/null | head -n 1 || true
)"
if [ -n "${UPTIME_NAME}" ]; then
  echo "- ${UPTIME_DISPLAY}: exists (${UPTIME_NAME}), left alone"
else
  echo "- ${UPTIME_DISPLAY}: creating"
  run gcloud monitoring uptime create "${UPTIME_DISPLAY}" \
    --resource-type=uptime-url \
    --resource-labels="project_id=${PROJECT_ID},host=${SERVICE_HOST}" \
    --protocol=https --port=443 --path=/v1/health/ready \
    --request-method=get --validate-ssl=true --status-codes=200 \
    --period=5 --timeout=10 \
    --regions=europe,usa-iowa,usa-oregon \
    --user-labels="deployment-env=${DEPLOYMENT_ENV},owner=country-flags,source=infrastructure-monitoring" \
    --project "${PROJECT_ID}"
  UPTIME_NAME="$(
    gcloud monitoring uptime list-configs --project "${PROJECT_ID}" \
      --filter="displayName='${UPTIME_DISPLAY}'" --format='value(name)' 2>/dev/null | head -n 1 || true
  )"
fi
# The alert filters on the check id, which is the last path segment of the
# config's resource name; there is no other stable handle for one check.
UPTIME_CHECK_ID="${UPTIME_NAME##*/}"
echo "  check id: ${UPTIME_CHECK_ID:-not created yet}"
echo

# ---------------------------------------------------------------------------
# 3. Alert policies
# ---------------------------------------------------------------------------
echo "== Alert policies =="
for policy in "${HERE}"/alert-policies/*.json; do
  name="$(basename "${policy}")"

  if [ "${DEPLOYMENT_ENV}" = "dev" ] && [ "${name}" = "restart-loop.json" ]; then
    # Dev scales to zero, so a process start after every idle period is normal
    # and this policy would be pure noise there.
    echo "- ${name}: skipped on dev (scale-to-zero makes restarts normal)"
    continue
  fi
  if [ "${name}" = "readiness-unreachable.json" ] && [ -z "${UPTIME_CHECK_ID}" ]; then
    # Its filter names a check id, and a policy filtering on an empty id would
    # match everything or nothing depending on the provider's mood. Refused.
    echo "- ${name}: skipped (no uptime check id yet; re-run after --apply creates it)"
    continue
  fi

  rendered="${WORK}/policy-${name}"
  substitute "${policy}" "${rendered}"
  display="$(display_name_of "${rendered}")"
  existing="$(
    gcloud monitoring policies list --project "${PROJECT_ID}" \
      --filter="displayName='${display}'" --format='value(name)' 2>/dev/null | head -n 1 || true
  )"
  if [ -n "${existing}" ]; then
    echo "- ${display}: exists, updating"
    run gcloud monitoring policies update "${existing}" \
      --policy-from-file="${rendered}" --project "${PROJECT_ID}"
  else
    echo "- ${display}: creating"
    run gcloud monitoring policies create \
      --policy-from-file="${rendered}" --project "${PROJECT_ID}"
  fi
done
echo

# ---------------------------------------------------------------------------
# 4. Dashboard
# ---------------------------------------------------------------------------
echo "== Dashboard =="
substitute "${HERE}/dashboard.json" "${WORK}/dashboard.json"
DASHBOARD_DISPLAY="$(display_name_of "${WORK}/dashboard.json")"
EXISTING_DASHBOARD="$(
  gcloud monitoring dashboards list --project "${PROJECT_ID}" \
    --filter="displayName='${DASHBOARD_DISPLAY}'" --format='value(name)' 2>/dev/null | head -n 1 || true
)"
if [ -n "${EXISTING_DASHBOARD}" ]; then
  echo "- ${DASHBOARD_DISPLAY}: exists, updating"
  run gcloud monitoring dashboards update "${EXISTING_DASHBOARD}" \
    --config-from-file="${WORK}/dashboard.json" --project "${PROJECT_ID}"
else
  echo "- ${DASHBOARD_DISPLAY}: creating"
  run gcloud monitoring dashboards create \
    --config-from-file="${WORK}/dashboard.json" --project "${PROJECT_ID}"
fi
echo

if [ "${APPLY}" != "true" ]; then
  echo "Dry run finished. Nothing was created. Re-run with --apply to write."
  echo "The first --apply creates the uptime check; run it once more afterwards"
  echo "so the readiness-unreachable policy can be written against its id."
fi
