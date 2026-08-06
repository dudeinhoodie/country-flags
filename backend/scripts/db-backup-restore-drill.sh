#!/usr/bin/env bash
# Reference implementation of the restore drill described in
# docs/10-backup-restore-runbook.md: dumps DATABASE_URL, restores the dump into a
# scratch database on the same server, and compares per-table row counts. Exits
# non-zero on any mismatch or if the restore itself fails.
#
# Uses `docker run postgres:16-alpine` for pg_dump/pg_restore/psql instead of requiring
# postgresql-client on the host, so the client version always matches the server this
# repo actually runs (see infrastructure/compose.yaml, .github/workflows/backend-ci.yml).
set -euo pipefail

DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required (e.g. postgresql://user:pass@localhost:5432/country_flags)}"
PG_IMAGE="postgres:16-alpine"
DUMP_DIR="$(mktemp -d)"
DUMP_FILE_NAME="backup-drill.dump"
SCRATCH_DB="restore_drill_$(date +%s)_$$"

docker_host_flags=()
if [[ "$(uname -s)" == "Linux" ]]; then
  # host-gateway lets a container reach the host's published ports on Linux CI
  # runners; Docker Desktop on macOS resolves host.docker.internal without this.
  docker_host_flags=(--add-host=host.docker.internal:host-gateway)
fi

container_database_url="${DATABASE_URL/127.0.0.1/host.docker.internal}"
container_database_url="${container_database_url/localhost/host.docker.internal}"
# Strip any query string (e.g. Prisma's "?schema=public") — it isn't a real libpq
# connection parameter and pg_dump/psql/pg_restore reject it outright.
container_database_url="${container_database_url%%\?*}"
admin_url="$(printf '%s' "$container_database_url" | sed -E 's#/[^/]+$#/postgres#')"
scratch_url="$(printf '%s' "$container_database_url" | sed -E "s#/[^/]+\$#/${SCRATCH_DB}#")"

pg() {
  # The ${arr[@]+"${arr[@]}"} form (not just "${arr[@]}") avoids "unbound variable"
  # under `set -u` when the array is empty — a bash <4.4 quirk (default on macOS).
  docker run --rm ${docker_host_flags[@]+"${docker_host_flags[@]}"} \
    --user "$(id -u):$(id -g)" \
    -v "${DUMP_DIR}:/dump" \
    "$PG_IMAGE" "$@"
}

cleanup() {
  pg psql "$admin_url" -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"${SCRATCH_DB}\" WITH (FORCE);" >/dev/null 2>&1 || true
  rm -rf "$DUMP_DIR"
}
trap cleanup EXIT

echo "==> Dumping source database"
pg pg_dump --format=custom --file="/dump/${DUMP_FILE_NAME}" "$container_database_url"

echo "==> Creating scratch database ${SCRATCH_DB}"
pg psql "$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${SCRATCH_DB}\";"

echo "==> Restoring dump into ${SCRATCH_DB}"
pg pg_restore --dbname="$scratch_url" --no-owner --no-privileges \
  "/dump/${DUMP_FILE_NAME}"

echo "==> Comparing per-table row counts"
tables="$(pg psql "$container_database_url" -t -A \
  -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;")"

mismatch=0
for table in $tables; do
  source_count="$(pg psql "$container_database_url" -t -A \
    -c "SELECT count(*) FROM \"${table}\";" | tr -d '[:space:]')"
  restored_count="$(pg psql "$scratch_url" -t -A \
    -c "SELECT count(*) FROM \"${table}\";" | tr -d '[:space:]')"
  if [[ "$source_count" != "$restored_count" ]]; then
    echo "MISMATCH: ${table} source=${source_count} restored=${restored_count}" >&2
    mismatch=1
  else
    echo "OK: ${table} (${source_count} rows)"
  fi
done

if [[ "$mismatch" -ne 0 ]]; then
  echo "==> Restore drill FAILED: row counts diverged" >&2
  exit 1
fi

echo "==> Restore drill passed: dump/restore round-trip matched on every table"
