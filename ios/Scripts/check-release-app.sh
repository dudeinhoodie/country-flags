#!/usr/bin/env bash
# Fails when a built app carries anything that must never reach the store.
#
# The debug affordances are behind `#if DEBUG` and the Release configurations
# compile them out, but "should be compiled out" is a claim about the source,
# and what ships is a binary. This reads the binary: the strings the test
# harness uses to reset the store, sign in as a fixture and pin an identity,
# and the mock backend's own hostname. It reads the bundle too, because not
# everything that ships is code — a Swift package product brings its resources
# with it, and that is how the mock catalogue used to travel. It also checks
# the two declarations the App Store needs and cannot infer — the privacy
# manifest and the export compliance answer.
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
#
# What this check can and cannot see, so it is not mistaken for more than it
# is: Swift stores a literal of fifteen bytes or fewer inside the instruction
# stream rather than in __cstring, and `strings` does not find those. Of the
# three below only "-installation-id" is long enough to be found reliably.
# The short ones stay because a build that grows a longer spelling still
# trips this, and because the real guarantee is elsewhere: `-reset-store` and
# `-installation-id` are compiled out by `#if DEBUG`, and `-fake-signin` is
# gated on an environment that answers false in Prod. This is the belt;
# those are the braces.
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

# No mock backend at all. Absence, not unreachability.
#
# This used to enforce the weaker thing, because the stronger one was not true:
# Xcode links every Swift package product a target depends on whatever the
# configuration, so the mock module rode into the store build with its fixtures
# and its resource bundle, and the most that could be asked was that nothing
# could *call* it. The mock backend is now a dependency of CountryFlagsAppMock,
# which the UI tests run against, and of no other target, so the bytes are gone
# and this asks for that.
#
# It asks three ways, because the easiest thing to check is the one a rename
# would quietly defeat.

# One: the resource bundle, by the name Xcode gives it.
while IFS= read -r bundle; do
  echo "::error::${bundle#"${app}/"} is the mock backend's resource bundle. A release build must not carry it." >&2
  status=1
done < <(find "${app}" -name "*MockBackend*")

# Two: the fixtures, by the names they carry in the source tree. A bundle that
# was renamed still copies these, and a module that stopped having resources
# would make the check above pass by having nothing left to find. If the source
# directory is not where this expects it, that is reported rather than skipped:
# a check that silently stops checking is worse than no check.
mock_resources="$(cd "$(dirname "$0")/.." && pwd)/CountryFlagsKit/Sources/CountryFlagsMockBackend/Resources"
if [[ ! -d "${mock_resources}" ]]; then
  echo "::error::${mock_resources} is missing; this check cannot tell whether the mock fixtures ship." >&2
  status=1
else
  while IFS= read -r fixture; do
    fixture_name="$(basename "${fixture}")"
    while IFS= read -r shipped; do
      echo "::error::${shipped#"${app}/"} is the mock fixture ${fixture_name}. A release build must not carry it." >&2
      status=1
    done < <(find "${app}" -name "${fixture_name}")
  done < <(find "${mock_resources}" -type f)
fi

# Three: what the module leaves in a binary. `nm` used to stand here alone and
# it was not enough — a release build strips its local symbols, so it reported
# a clean binary that in fact carried the module's type metadata and the host
# "mock.invalid" in full. The strings are the honest reading; `nm` stays
# because a symbol is the thing that would let a release build call any of it.
MOCK_STRINGS=(
  "mock.invalid"
  "CountryFlagsMockBackend"
)
for binary in "${binaries[@]}"; do
  for needle in "${MOCK_STRINGS[@]}"; do
    if grep -qF -- "${needle}" < <(strings -a "${binary}"); then
      echo "::error::${needle} is present in ${binary#"${app}/"}. A release build must not carry the mock backend." >&2
      status=1
    fi
  done
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
