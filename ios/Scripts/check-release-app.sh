#!/usr/bin/env bash
# Fails when a built app carries anything that must never reach the store.
#
# The debug affordances are behind `#if DEBUG` and the Release configurations
# compile them out, but "should be compiled out" is a claim about the source,
# and what ships is a binary. This reads the binary: the strings the test
# harness uses to reset the store, sign in as a fixture and pin an identity,
# and the mock backend's own hostname. It also checks the two declarations the
# App Store needs and cannot infer — the privacy manifest and the export
# compliance answer.
#
#   ios/Scripts/check-release-app.sh <path to a built .app>
set -euo pipefail

app="${1:-}"
if [[ -z "${app}" || ! -d "${app}" ]]; then
  echo "usage: $(basename "$0") <path to a built .app>" >&2
  exit 2
fi

name="$(basename "${app}" .app)"

# Every Mach-O in the bundle, not just the one named after it. A debug build
# keeps its code in a companion dylib beside the executable, so a check that
# read the main binary alone would pass a bundle full of the very strings it
# is looking for — and pass it silently.
binaries=()
while IFS= read -r candidate; do
  if file -b "${candidate}" | grep -q "Mach-O"; then
    binaries+=("${candidate}")
  fi
done < <(find "${app}" -type f \( -perm -u+x -o -name "*.dylib" \) -not -path "*/_CodeSignature/*")

if [[ "${#binaries[@]}" -eq 0 ]]; then
  echo "::error::No executable found inside ${app}" >&2
  exit 1
fi

status=0

# Every launch argument the UI tests use. In a Release build the code that
# reads them does not exist, so neither should the literals.
FORBIDDEN_STRINGS=(
  "-reset-store"
  "-fake-signin"
  "-installation-id"
)
for needle in "${FORBIDDEN_STRINGS[@]}"; do
  for binary in "${binaries[@]}"; do
    # Process substitution rather than a pipe: `grep -q` stops at the first
    # match, `strings` dies of SIGPIPE, and under `pipefail` that made the whole
    # pipeline "fail" — so every match read as no match and this check passed
    # everything, including a binary full of what it looks for.
    if grep -qF -- "${needle}" < <(strings -a "${binary}"); then
      echo "::error::${needle} is present in ${binary#"${app}/"}. A release build must not carry debug affordances." >&2
      status=1
    fi
  done
done

# No mock backend a release build could call.
#
# What is enforced is reachability, not absence: Xcode links every Swift package
# product a target depends on, whatever the configuration, so the mock module's
# object file rides along and its fixture strings — including the unreachable
# host "mock.invalid" — sit in the binary as dead data. What must not happen is
# a release build being able to *call* any of it, and that is what this checks:
# no symbol of the module survives linking, because nothing in a release build
# refers to it. Getting the bytes out too needs a second app target; see the
# issue linked from docs/ios/release-checklist.md.
for binary in "${binaries[@]}"; do
  if nm "${binary}" 2>/dev/null | grep -q "CountryFlagsMockBackend"; then
    echo "::error::${binary#"${app}/"} links symbols from the mock backend." >&2
    status=1
  fi
done

# The environment the build says it is. A store build that still points at dev
# would pass every other check in this file.
environment="$(/usr/libexec/PlistBuddy -c "Print :CFAppEnvironment" "${app}/Info.plist" 2>/dev/null || echo "")"
if [[ "${environment}" != "prod" ]]; then
  echo "::error::CFAppEnvironment is '${environment}', not 'prod'." >&2
  status=1
fi

base_url="$(/usr/libexec/PlistBuddy -c "Print :CFAPIBaseURL" "${app}/Info.plist" 2>/dev/null || echo "")"
case "${base_url}" in
  https://*) ;;
  *)
    echo "::error::CFAPIBaseURL is '${base_url}', which is not an https endpoint." >&2
    status=1
    ;;
esac

# The privacy manifest travels inside the bundle; Apple reads it from there.
if [[ ! -f "${app}/PrivacyInfo.xcprivacy" ]]; then
  echo "::error::PrivacyInfo.xcprivacy is missing from ${name}." >&2
  status=1
elif ! plutil -lint "${app}/PrivacyInfo.xcprivacy" >/dev/null; then
  echo "::error::PrivacyInfo.xcprivacy is not a readable property list." >&2
  status=1
fi

encryption="$(/usr/libexec/PlistBuddy -c "Print :ITSAppUsesNonExemptEncryption" "${app}/Info.plist" 2>/dev/null || echo "missing")"
if [[ "${encryption}" != "false" ]]; then
  echo "::error::ITSAppUsesNonExemptEncryption is '${encryption}'; every upload will stop and ask." >&2
  status=1
fi

if /usr/libexec/PlistBuddy -c "Print :NSUserTrackingUsageDescription" "${app}/Info.plist" >/dev/null 2>&1; then
  echo "::error::NSUserTrackingUsageDescription is declared. There is no tracking in this app." >&2
  status=1
fi

# The legal links are shipped inside the build and cannot be corrected after
# it leaves: an app that creates accounts owes its reader a privacy policy
# that answers, and a link into nothing is worse than the hidden section it
# replaced. Both must be set, and both must be reachable right now.
for key in CFPrivacyPolicyURL CFTermsURL; do
  url="$(/usr/libexec/PlistBuddy -c "Print :${key}" "${app}/Info.plist" 2>/dev/null || echo "")"
  if [[ -z "${url}" ]]; then
    echo "::error::${key} is empty; the app would hide its legal section." >&2
    status=1
    continue
  fi
  if [[ "${url}" != https://* ]]; then
    echo "::error::${key} is '${url}', which is not an https address." >&2
    status=1
    continue
  fi
  code="$(curl -sS -m 20 -o /dev/null -w "%{http_code}" -L "${url}" || echo "000")"
  if [[ "${code}" != "200" ]]; then
    echo "::error::${key} (${url}) answered ${code}; a shipped link must answer 200." >&2
    status=1
  fi
done

if [[ "${status}" -eq 0 ]]; then
  echo "${name}: ${#binaries[@]} Mach-O file(s) scanned, no debug affordance, production endpoint, store declarations present."
fi

exit "${status}"
