#!/usr/bin/env bash
# Печатает destination для xcodebuild, выбирая первый доступный симулятор из
# зафиксированного списка предпочтений.
#
# Имя устройства зависит от версии Xcode на машине и на CI-раннере, поэтому
# жёстко зашитое `name=iPhone 17` ломается при смене образа. Список ниже задаёт
# порядок предпочтений, а выбранное устройство печатается в лог, чтобы прогон
# оставался воспроизводимым.
set -euo pipefail

# Порядок: сначала свежие модели, затем те, что покрывают минимальный
# поддерживаемый iOS 17.
PREFERRED_DEVICES=(
  "iPhone 17 Pro"
  "iPhone 17"
  "iPhone 16 Pro"
  "iPhone 16"
  "iPhone 15 Pro"
  "iPhone 15"
)

devices_json="$(xcrun simctl list devices available --json)"

for device in "${PREFERRED_DEVICES[@]}"; do
  found="$(
    DEVICE_NAME="${device}" python3 - "${devices_json}" <<'PY'
import json
import os
import sys

wanted = os.environ["DEVICE_NAME"]
catalog = json.loads(sys.argv[1])["devices"]
matches = []

for runtime, devices in catalog.items():
    if "iOS" not in runtime:
        continue
    # com.apple.CoreSimulator.SimRuntime.iOS-17-4 -> (17, 4)
    version = runtime.rsplit(".", 1)[-1].removeprefix("iOS-")
    try:
        parsed = tuple(int(part) for part in version.split("-"))
    except ValueError:
        continue
    if parsed < (17, 0):
        continue
    for device in devices:
        if device.get("isAvailable") and device.get("name") == wanted:
            matches.append((parsed, device["udid"], ".".join(str(p) for p in parsed)))

if matches:
    matches.sort(reverse=True)
    _, udid, os_version = matches[0]
    print(f"{udid}\t{os_version}")
PY
  )"

  if [[ -n "${found}" ]]; then
    udid="${found%%$'\t'*}"
    os_version="${found##*$'\t'}"
    echo "Selected simulator: ${device} (iOS ${os_version}, ${udid})" >&2
    echo "platform=iOS Simulator,id=${udid}"
    exit 0
  fi
done

echo "No simulator from the preferred list is available. Installed devices:" >&2
xcrun simctl list devices available >&2
exit 1
