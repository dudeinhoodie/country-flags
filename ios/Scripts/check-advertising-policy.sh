#!/usr/bin/env bash
# Fails when the build starts to contain advertising or tracking machinery.
#
# Advertising is off in the MVP: the app ships `NoOpAdvertisingProvider` and no
# ad network, no advertising identifier and no App Tracking Transparency
# prompt. Unit tests can prove that none of those frameworks is linked into the
# package, but not that the app target has stayed clean, so the declarations are
# checked here. Adding any of them needs its own ADR and privacy review, and
# then this list.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${script_dir}/../.." && pwd)"

# Usage descriptions and entitlements that would make a tracking prompt possible.
FORBIDDEN_INFO_KEYS=(
  "NSUserTrackingUsageDescription"
  "SKAdNetworkItems"
)

# Frameworks and packages that would collect an advertising identifier.
FORBIDDEN_DEPENDENCIES=(
  "AppTrackingTransparency"
  "AdSupport"
  "GoogleMobileAds"
  "google-mobile-ads"
  "AppLovin"
  "FBAudienceNetwork"
)

status=0

info_plist="${repository_root}/ios/Config/App-Info.plist"
for key in "${FORBIDDEN_INFO_KEYS[@]}"; do
  if grep -q "${key}" "${info_plist}"; then
    echo "::error::${key} is declared in ios/Config/App-Info.plist. Advertising is off in the MVP." >&2
    status=1
  fi
done

SEARCHED_FILES=(
  "${repository_root}/ios/CountryFlags.xcodeproj/project.pbxproj"
  "${repository_root}/ios/CountryFlagsKit/Package.swift"
  "${repository_root}/ios/CountryFlagsKit/Package.resolved"
)
for dependency in "${FORBIDDEN_DEPENDENCIES[@]}"; do
  for file in "${SEARCHED_FILES[@]}"; do
    if [[ -f "${file}" ]] && grep -q "${dependency}" "${file}"; then
      echo "::error::${dependency} appears in ${file#"${repository_root}/"}. An ad or tracking SDK needs its own ADR and privacy review." >&2
      status=1
    fi
  done
done

if [[ "${status}" -eq 0 ]]; then
  echo "No advertising or tracking framework is declared."
fi

exit "${status}"
