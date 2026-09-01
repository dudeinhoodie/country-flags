#!/usr/bin/env bash
# Takes the App Store screenshots and files them by device and language.
#
# Driven by hand rather than by CI: a screenshot run is minutes of tapping per
# device and language, it asserts no product rule, and its output is reviewed
# by eye before it goes anywhere near a submission.
#
#   ios/Scripts/capture-screenshots.sh                     # every device, both languages
#   ios/Scripts/capture-screenshots.sh "iPhone 17 Pro Max" # one device
#
# The pictures land in ios/StoreMetadata/screenshots/<device>/<language>/ as
# PNGs named by the step that took them. They are deliberately not committed:
# the store copy is versioned, its illustrations are rebuilt.
set -euo pipefail

repository="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
project="${repository}/ios/CountryFlags.xcodeproj"
output="${repository}/ios/StoreMetadata/screenshots"

# What App Store Connect asks for: the 6.9" and the 6.5" classes. Everything
# smaller is derived by Apple from these.
DEVICES=("iPhone 17 Pro Max" "iPhone 16e")
if [[ $# -gt 0 ]]; then
  DEVICES=("$@")
fi
LANGUAGES=("en" "ru")

# Mock, not Dev: the release it answers with is deterministic, so the same run
# produces the same numbers on the home screen and the same ring on progress.
scheme="CountryFlags-Mock"

for device in "${DEVICES[@]}"; do
  for language in "${LANGUAGES[@]}"; do
    echo "==> ${device} · ${language}"
    result="$(mktemp -d)/run.xcresult"

    xcodebuild test \
      -project "${project}" \
      -scheme "${scheme}" \
      -destination "platform=iOS Simulator,name=${device}" \
      -only-testing:CountryFlagsUITests/StoreScreenshotUITests \
      -resultBundlePath "${result}" \
      -skipPackagePluginValidation \
      CODE_SIGNING_ALLOWED=NO \
      -testLanguage "${language}" \
      -testRegion "$([[ "${language}" == "ru" ]] && echo RU || echo US)" \
      || echo "    the run reported a failure; exporting whatever it captured"

    destination="${output}/${device// /-}/${language}"
    mkdir -p "${destination}"

    # The attachments are named by the test; xcresulttool exports them under
    # those names, so the export is a copy rather than a puzzle.
    xcrun xcresulttool export attachments \
      --path "${result}" \
      --output-path "${destination}" \
      >/dev/null

    count="$(find "${destination}" -name "*.png" | wc -l | tr -d ' ')"
    echo "    ${count} picture(s) in ${destination#"${repository}/"}"
  done
done

echo
echo "Review them by eye before they go near a submission: a screenshot of a"
echo "half-loaded screen passes every check in this file."
