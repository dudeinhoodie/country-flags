// swift-tools-version: 6.0
import PackageDescription

// Application logic lives here; the app target stays a composition root.
// Another target is added only for a proven compile-time or ownership reason.
let package = Package(
    name: "CountryFlagsKit",
    defaultLocalization: "en",
    platforms: [.iOS("26.0")],
    products: [
        .library(name: "CountryFlagsDomain", targets: ["CountryFlagsDomain"]),
        .library(name: "CountryFlagsInfrastructure", targets: ["CountryFlagsInfrastructure"]),
        .library(name: "CountryFlagsFeatures", targets: ["CountryFlagsFeatures"]),
        // The mock backend is a product of its own so that a release build can
        // leave it on the shelf. See the target for why that matters.
        .library(name: "CountryFlagsMockBackend", targets: ["CountryFlagsMockBackend"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.9.0"),
        .package(url: "https://github.com/google/GoogleSignIn-iOS", from: "8.0.0"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.1.0"),
        // The evaluation API only. The provider is ours: the backend evaluates
        // the rules, so no control plane SDK is linked into the app.
        // Up to the next minor, not the next major: below 1.0 a minor is
        // where this SDK makes breaking changes, and 0.6 moved a provider's
        // event publisher to an optional element. `from:` let a fresh
        // resolution take it, so the app target stopped compiling while the
        // package — pinned a version back — still did, and which of the two
        // you got depended on what a build directory happened to have cached.
        .package(
            url: "https://github.com/open-feature/swift-sdk",
            .upToNextMinor(from: "0.5.0")
        ),
    ],
    targets: [
        // Imports neither SwiftUI, SwiftData, OpenFeature nor an OAuth SDK.
        .target(name: "CountryFlagsDomain"),
        // The generated client and its DTOs stay internal to this target;
        // feature code receives domain models and typed domain errors.
        .target(
            name: "CountryFlagsInfrastructure",
            dependencies: [
                "CountryFlagsDomain",
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
                .product(name: "OpenFeature", package: "swift-sdk"),
            ],
            plugins: [
                .plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")
            ]
        ),
        // A backend in a bundle: canned responses for every operation the app
        // calls, so the Mock build runs with no server and no socket.
        //
        // Its own target for a reason that only shows up in the release
        // binary. A Swift module is compiled whole-module in release, so the
        // linker pulls all of it in as soon as anything references any part of
        // it — and while these files sat inside the infrastructure target, the
        // App Store build carried the fixtures and the string "mock.invalid"
        // with them. As a separate module nothing in a release build refers to
        // it, so nothing of it is linked.
        .target(
            name: "CountryFlagsMockBackend",
            dependencies: [
                "CountryFlagsDomain",
                // Two fetchers are answered locally as well as the transport:
                // the Mock build downloads neither an archive nor an asset.
                "CountryFlagsInfrastructure",
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
            ],
            // Copied rather than processed: the mock reads the documents by
            // name out of their directory, and processing would flatten it.
            resources: [.copy("Resources/MockContent")]
        ),
        .target(
            name: "CountryFlagsFeatures",
            dependencies: [
                "CountryFlagsDomain",
                .product(name: "GoogleSignIn", package: "GoogleSignIn-iOS"),
            ],
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "CountryFlagsDomainTests",
            dependencies: ["CountryFlagsDomain"]
        ),
        .testTarget(
            name: "CountryFlagsInfrastructureTests",
            // The mock transport is the double these tests answer with.
            dependencies: ["CountryFlagsInfrastructure", "CountryFlagsMockBackend"]
        ),
        .testTarget(
            name: "CountryFlagsFeaturesTests",
            dependencies: ["CountryFlagsFeatures"]
        ),
    ]
)
