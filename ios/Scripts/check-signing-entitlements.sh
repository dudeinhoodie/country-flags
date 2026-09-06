#!/usr/bin/env bash
# Fails when an app target has lost the entitlements it cannot work without.
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
# every configuration of every application target still resolves to the file,
# and that the file still declares the capability — which is exactly what
# silently went missing before.
#
# It resolves rather than counts. There are two application targets now — the
# one that ships and the one that links the mock backend for the UI tests —
# and the setting they share lives in `Config/App.xcconfig`, so a check that
# grepped the project file for the literal line would have found none at all.
# The project is read as the property list it is, each application target's
# build configurations are followed through their xcconfig chain, and the
# value that comes out is what the build would use.
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

# Every configuration of every application target must resolve to the
# entitlements file and to the app's own Info.plist. The plist is not
# incidental: it is how a reader of this check can tell an application target
# from a test bundle without hard-coding target names.
project_json="$(mktemp -t project-json)"
trap 'rm -f "${project_json}"' EXIT
plutil -convert json -o "${project_json}" "${project}"

if ! ENTITLEMENTS="${entitlements}" python3 - "${project}" "${project_json}" <<'PY'
import json
import os
import re
import sys

project_path = sys.argv[1]
expected_entitlements = os.environ["ENTITLEMENTS"]
expected_info_plist = "Config/App-Info.plist"
APPLICATION = "com.apple.product-type.application"

with open(sys.argv[2], encoding="utf-8") as handle:
    objects = json.load(handle)["objects"]
status = 0


def error(message):
    global status
    print(f"::error::{message}", file=sys.stderr)
    status = 1


def settings_of_xcconfig(path, seen):
    """Every setting an xcconfig defines, its includes resolved in order."""
    if path in seen or not os.path.isfile(path):
        return {}
    seen.add(path)
    settings = {}
    include = re.compile(r'^\s*#include\??\s+"([^"]+)"')
    assignment = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$")
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if line.lstrip().startswith("//"):
                continue
            included = include.match(line)
            if included:
                settings.update(
                    settings_of_xcconfig(
                        os.path.normpath(
                            os.path.join(os.path.dirname(path), included.group(1))
                        ),
                        seen,
                    )
                )
                continue
            defined = assignment.match(line)
            if defined:
                settings[defined.group(1)] = defined.group(2)
    return settings


def settings_of_configuration(identifier):
    """A build configuration's settings: its xcconfig chain, then its own."""
    configuration = objects[identifier]
    settings = {}
    reference = configuration.get("baseConfigurationReference")
    if reference:
        settings.update(settings_of_xcconfig(path_of(reference), set()))
    settings.update(configuration.get("buildSettings", {}))
    return settings


def path_of(file_reference):
    """The repository path of a file reference, through its parent groups."""
    reference = objects[file_reference]
    path = reference.get("path", "")
    for identifier, candidate in objects.items():
        if candidate.get("isa") != "PBXGroup":
            continue
        if file_reference in candidate.get("children", []):
            parent = candidate.get("path")
            if parent:
                return os.path.join(parent, path)
            break
    return path


applications = [
    (identifier, target)
    for identifier, target in objects.items()
    if target.get("isa") == "PBXNativeTarget" and target.get("productType") == APPLICATION
]

if not applications:
    error(
        f"{project_path} declares no application target; "
        "this check no longer knows which target is the app."
    )

# The project's own configurations sit under every target's, so a setting the
# target does not name is inherited from there.
project_object = next(
    value for value in objects.values() if value.get("isa") == "PBXProject"
)
project_configurations = {
    objects[identifier]["name"]: settings_of_configuration(identifier)
    for identifier in objects[project_object["buildConfigurationList"]][
        "buildConfigurations"
    ]
}

for identifier, target in applications:
    name = target.get("name", identifier)
    configurations = objects[target["buildConfigurationList"]]["buildConfigurations"]
    if not configurations:
        error(f"The application target {name} has no build configuration.")
    for configuration_id in configurations:
        configuration = objects[configuration_id]
        resolved = dict(project_configurations.get(configuration["name"], {}))
        resolved.update(settings_of_configuration(configuration_id))
        where = f"{name}/{configuration['name']}"
        if resolved.get("INFOPLIST_FILE") != expected_info_plist:
            error(
                f"{where} sets INFOPLIST_FILE to "
                f"'{resolved.get('INFOPLIST_FILE', '')}', not {expected_info_plist}; "
                "an application target without the app's own Info.plist drops "
                "every key the store reads."
            )
        if resolved.get("CODE_SIGN_ENTITLEMENTS") != expected_entitlements:
            error(
                f"{where} sets CODE_SIGN_ENTITLEMENTS to "
                f"'{resolved.get('CODE_SIGN_ENTITLEMENTS', '')}', not "
                f"{expected_entitlements}; Sign in with Apple fails with error "
                "1000 on a device."
            )

sys.exit(status)
PY
then
  status=1
fi

# A second entitlements file would split the app's capabilities between two
# places, and the one nobody edits is the one that ships. One line in one
# xcconfig names the file; nothing else may.
named="$(grep -l "CODE_SIGN_ENTITLEMENTS" "${project}" Config/*.xcconfig || true)"
if [[ -z "${named}" ]]; then
  echo "::error::Nothing names an entitlements file; Config/App.xcconfig is where the app declares its capabilities." >&2
  status=1
elif [[ "${named}" != "Config/App.xcconfig" ]]; then
  echo "::error::CODE_SIGN_ENTITLEMENTS is set outside Config/App.xcconfig: ${named//$'\n'/, }" >&2
  status=1
fi

if [[ "${status}" -eq 0 ]]; then
  count="$(grep -c 'productType = "com.apple.product-type.application";' "${project}" || true)"
  echo "Signing entitlements: ${count} application target(s) resolve ${entitlements}, which declares Sign in with Apple."
fi

exit "${status}"
