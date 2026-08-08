#!/usr/bin/env bash
# Mirrors the canonical bundled OpenAPI document into the iOS package.
#
# The generator build plugin needs the document inside the target it generates
# for, while `contracts/openapi.yaml` is split across files and is the single
# source of truth. This script bundles the canonical contract and copies the
# result next to the package.
#
#   ./Scripts/sync-openapi.sh           update the mirror
#   ./Scripts/sync-openapi.sh --check   fail when the mirror is stale (CI)
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${script_dir}/../.." && pwd)"
mirror="${repository_root}/ios/CountryFlagsKit/Contracts/openapi.bundle.yaml"
bundle="${repository_root}/contracts/dist/openapi.bundle.yaml"

check_only=false
if [[ "${1:-}" == "--check" ]]; then
  check_only=true
elif [[ -n "${1:-}" ]]; then
  echo "Usage: $(basename "$0") [--check]" >&2
  exit 2
fi

echo "Bundling the canonical contract."
(cd "${repository_root}" && corepack yarn contracts:bundle >/dev/null)

if [[ ! -f "${bundle}" ]]; then
  echo "::error::${bundle} was not produced by contracts:bundle" >&2
  exit 1
fi

if "${check_only}"; then
  if ! diff -u "${mirror}" "${bundle}" >/dev/null 2>&1; then
    echo "::error::${mirror#"${repository_root}/"} is stale. Run ios/Scripts/sync-openapi.sh and commit the result." >&2
    diff -u "${mirror}" "${bundle}" || true
    exit 1
  fi
  echo "The iOS contract mirror matches the canonical bundle."
  exit 0
fi

mkdir -p "$(dirname "${mirror}")"
cp "${bundle}" "${mirror}"
echo "Updated ${mirror#"${repository_root}/"}"
