#!/usr/bin/env bash
# Fails when the app has lost the entitlements it cannot work without.
#
# Sign in with Apple is the only way into a Prod build — the Google button is
# hidden wherever its client identifiers are unset, and Prod never sets them.
# Without `com.apple.developer.applesignin` the authorization controller fails
# with error 1000 on a signed device, so the single door errors on tap.
#
# This reads the source rather than a built app on purpose. CI archives with
# `CODE_SIGNING_ALLOWED=NO`, and an unsigned binary carries no entitlements at
# all, so `codesign -d --entitlements` would have nothing to say and the check
# would pass an app that had lost the setting. What can be proved here is that
# the project still points at the file and that the file still declares the
# capability — which is exactly what silently went missing before.
#
# What it cannot prove: the capability is also enabled for the App ID in the
# developer portal. No file in this repository knows that, and a device build
# is where it shows.
#
#   ios/Scripts/check-signing-entitlements.sh
set -euo pipefail

cd "$(dirname "$0")/.."

project="CountryFlags.xcodeproj/project.pbxproj"
entitlements="Config/CountryFlags.entitlements"
status=0

if [[ ! -f "${entitlements}" ]]; then
  echo "::error::${entitlements} is missing; the app would ship with no entitlements." >&2
  exit 1
fi

if ! plutil -lint "${entitlements}" >/dev/null; then
  echo "::error::${entitlements} is not a readable property list." >&2
  status=1
fi

# `Default` is the primary app identifier: this app signs its own users in and
# shares no account with a sibling app.
signin="$(/usr/libexec/PlistBuddy -c "Print :com.apple.developer.applesignin:0" "${entitlements}" 2>/dev/null || echo "")"
if [[ "${signin}" != "Default" ]]; then
  echo "::error::${entitlements} does not declare com.apple.developer.applesignin = Default; Sign in with Apple fails with error 1000 on a device." >&2
  status=1
fi

# Every configuration that builds the app must name the file. The app target is
# identified by the Info.plist it alone sets, so the invariant is a comparison
# rather than a count someone has to keep in step with the configuration list:
# whatever configuration is the app, it also carries the entitlements.
app_configurations="$(grep -c "INFOPLIST_FILE = Config/App-Info.plist;" "${project}" || true)"
entitled_configurations="$(grep -c "CODE_SIGN_ENTITLEMENTS = ${entitlements};" "${project}" || true)"
if [[ "${app_configurations}" -eq 0 ]]; then
  echo "::error::No build configuration sets INFOPLIST_FILE = Config/App-Info.plist; this check no longer knows which target is the app." >&2
  status=1
elif [[ "${entitled_configurations}" -ne "${app_configurations}" ]]; then
  echo "::error::${entitled_configurations} of ${app_configurations} app configurations set CODE_SIGN_ENTITLEMENTS = ${entitlements}." >&2
  status=1
fi

# A second entitlements file would split the app's capabilities between two
# places, and the one nobody edits is the one that ships.
total="$(grep -c "CODE_SIGN_ENTITLEMENTS = " "${project}" || true)"
if [[ "${total}" -ne "${entitled_configurations}" ]]; then
  echo "::error::${project} names an entitlements file other than ${entitlements}." >&2
  status=1
fi

if [[ "${status}" -eq 0 ]]; then
  echo "Signing entitlements: ${app_configurations} app configuration(s) carry ${entitlements}, which declares Sign in with Apple."
fi

exit "${status}"
