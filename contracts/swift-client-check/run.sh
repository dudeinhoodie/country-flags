#!/usr/bin/env bash
# Regenerates a Swift client from the canonical bundled contract and runs the
# forward-compatibility tests. Requires a Swift 6 toolchain and network access
# for the two Apple packages.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
contracts_dir="$(cd "${script_dir}/.." && pwd)"
bundle="${contracts_dir}/dist/openapi.bundle.yaml"

if [[ ! -f "${bundle}" ]]; then
  echo "Bundling the canonical contract first."
  (cd "${contracts_dir}/.." && corepack yarn contracts:bundle)
fi

cp "${bundle}" "${script_dir}/Sources/CountryFlagsAPI/openapi.yaml"
cd "${script_dir}"
swift test "$@"
