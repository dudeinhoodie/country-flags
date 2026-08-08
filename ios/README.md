# iOS client

The Swift 6 / SwiftUI / iOS 17+ client of Country Flags.

This file covers only how to run the project. Product requirements live in
[docs/02-ios-spec.md](../docs/02-ios-spec.md), the order of work packages in
[docs/ios/README.md](../docs/ios/README.md), and the shape of the API contract in
[docs/15-ios-client-readiness.md](../docs/15-ios-client-readiness.md).

## Layout

```text
ios/
├── CountryFlags.xcodeproj      # composition root, three configurations
├── CountryFlagsApp/            # @main, dependency wiring, assets
├── CountryFlagsKit/            # local Swift package holding the logic
│   └── Sources/
│       ├── CountryFlagsDomain          # types and rules; no UI, no SDKs
│       ├── CountryFlagsInfrastructure  # boundaries to the outside world
│       └── CountryFlagsFeatures        # SwiftUI, navigation, design tokens
├── CountryFlagsUITests/        # launch smoke
├── Config/                     # one xcconfig per configuration
└── Scripts/select-simulator.sh # picks an xcodebuild destination
```

The logic lives in the package rather than in the app target: the package builds
and tests on its own and the Xcode project stays thin. A new target is added
only for a proven compile-time or ownership reason.

`CountryFlagsDomain` imports neither SwiftUI, SwiftData, OpenFeature nor an OAuth
SDK, which its dependencies in `Package.swift` enforce.

## Requirements

- Xcode 16 or newer for the Swift 6 language mode. The project was authored on
  Xcode 26.0.1 and CI runs it on Xcode 16.4.
- The iOS platform component and at least one iOS 17+ simulator:
  `xcodebuild -downloadPlatform iOS`, or Xcode → Settings → Components.
- No signing: builds and tests run on a simulator with
  `CODE_SIGNING_ALLOWED=NO`.

## Schemes and configurations

| Scheme              | Configuration | Environment | Purpose                                      |
| ------------------- | ------------- | ----------- | -------------------------------------------- |
| `CountryFlags-Mock` | `Mock`        | `mock`      | deterministic run and tests without network   |
| `CountryFlags-Dev`  | `Dev`         | `dev`       | build against the dev backend deployment      |
| `CountryFlags-Prod` | `Prod`        | `prod`      | release build, no mock transport, no debug UI |

The environment travels from an xcconfig into Info.plist and is read by
`RuntimeConfigurationLoader`. Conditional compilation does not pick it: there
are three configurations and only two compilation conditions.

Only the Mock scheme runs tests; it covers the package unit tests and the UI
launch smoke.

## Build and test

```bash
cd ios

# Prints the destination and the selected simulator.
./Scripts/select-simulator.sh

xcodebuild -project CountryFlags.xcodeproj -scheme CountryFlags-Mock \
  -destination "$(./Scripts/select-simulator.sh)" \
  CODE_SIGNING_ALLOWED=NO build

xcodebuild -project CountryFlags.xcodeproj -scheme CountryFlags-Mock \
  -destination "$(./Scripts/select-simulator.sh)" \
  CODE_SIGNING_ALLOWED=NO test

xcodebuild -project CountryFlags.xcodeproj -scheme CountryFlags-Dev \
  -destination "$(./Scripts/select-simulator.sh)" \
  CODE_SIGNING_ALLOWED=NO build
```

Simulator names change between Xcode versions, so `select-simulator.sh` takes
the first available device from a fixed preference list (iPhone 17 Pro → … →
iPhone 15) on an iOS 17 or newer runtime and prints the choice to stderr. CI
uses the same script, so a local and a remote run pick a device the same way.

## Local configuration and secrets

```bash
cp Config/Local.xcconfig.example Config/Local.xcconfig
```

`Config/Local.xcconfig` is not committed and holds developer identifiers only:
`CF_DEVELOPMENT_TEAM`, a personal bundle id suffix and, when needed, the address
of a local backend.

Secret policy:

- tokens, provider keys, signing identities, provisioning profiles and local
  paths never enter the repository;
- the values in `Base/Mock/Dev/Prod.xcconfig` are public: an environment name, a
  public base URL and a URL scheme;
- from later work packages on, access and refresh tokens live in the Keychain
  and never reach UserDefaults, SwiftData, logs or analytics;
- an xcconfig cannot contain a bare `//`; write `https:/$()/` instead.

## Dependencies

There are no external packages yet: system frameworks cover everything this work
package needs. That is why the repository holds no `Package.resolved` — Xcode
creates it together with the first remote dependency, and from that point the
file is committed alongside the change that introduces it. The first external
packages arrive with IOS-002 (swift-openapi-generator) and IOS-009
(Google Sign-In).

## CI

[`.github/workflows/ios-ci.yml`](../.github/workflows/ios-ci.yml) runs on changes
under `ios/**`: it checks the Xcode version, selects a simulator, builds and
tests Mock, then builds Dev. A failing run uploads the `.xcresult` bundle as an
artifact.
