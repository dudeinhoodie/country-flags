#!/usr/bin/env bash
# Mirrors the canonical registries into the iOS package tests.
#
# `contracts/registries/*.json` is the single source of truth for flag keys,
# types, defaults, activation policies and ad placements. The Swift registry
# spells the same entries out as typed enums so a screen cannot name a key that
# does not exist; the mirror lets a unit test prove the two still agree.
#
#   ./Scripts/sync-registries.sh           update the mirrors
#   ./Scripts/sync-registries.sh --check   fail when a mirror is stale (CI)
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${script_dir}/../.." && pwd)"
source_dir="${repository_root}/contracts/registries"
mirror_dir="${repository_root}/ios/CountryFlagsKit/Tests/CountryFlagsDomainTests/Resources"

REGISTRIES=(
  "feature-flags.json"
  "ad-placements.json"
)

check_only=false
if [[ "${1:-}" == "--check" ]]; then
  check_only=true
elif [[ -n "${1:-}" ]]; then
  echo "Usage: $(basename "$0") [--check]" >&2
  exit 2
fi

mkdir -p "${mirror_dir}"
status=0

for registry in "${REGISTRIES[@]}"; do
  source_file="${source_dir}/${registry}"
  mirror_file="${mirror_dir}/${registry}"

  if [[ ! -f "${source_file}" ]]; then
    echo "::error::${source_file#"${repository_root}/"} is missing" >&2
    exit 1
  fi

  if "${check_only}"; then
    if ! diff -u "${mirror_file}" "${source_file}" >/dev/null 2>&1; then
      echo "::error::${mirror_file#"${repository_root}/"} is stale. Run ios/Scripts/sync-registries.sh and commit the result." >&2
      diff -u "${mirror_file}" "${source_file}" || true
      status=1
    fi
  else
    cp "${source_file}" "${mirror_file}"
    echo "Updated ${mirror_file#"${repository_root}/"}"
  fi
done

if "${check_only}" && [[ "${status}" -eq 0 ]]; then
  echo "The iOS registry mirrors match the canonical registries."
fi

exit "${status}"
