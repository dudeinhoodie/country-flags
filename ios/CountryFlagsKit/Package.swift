// swift-tools-version: 6.0
import PackageDescription

// Application logic lives here; the app target stays a composition root.
// Another target is added only for a proven compile-time or ownership reason.
let package = Package(
    name: "CountryFlagsKit",
    defaultLocalization: "en",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "CountryFlagsDomain", targets: ["CountryFlagsDomain"]),
        .library(name: "CountryFlagsInfrastructure", targets: ["CountryFlagsInfrastructure"]),
        .library(name: "CountryFlagsFeatures", targets: ["CountryFlagsFeatures"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.9.0"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.1.0"),
        .package(url: "https://github.com/open-feature/swift-sdk", from: "0.5.0"),
    ],
    targets: [
        // Imports neither SwiftUI, SwiftData, OpenFeature nor an OAuth SDK.
        .target(name: "CountryFlagsDomain"),
        // The generated client and its DTOs stay internal to this target;
        // feature code receives domain models and typed domain errors. The
        // OpenFeature SDK is confined here too: a feature depends on
        // `FeatureFlagProviding`, never on an evaluation SDK.
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
        .target(
            name: "CountryFlagsFeatures",
            dependencies: ["CountryFlagsDomain"],
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "CountryFlagsDomainTests",
            dependencies: ["CountryFlagsDomain"],
            // Mirrors of the canonical registries, refreshed by
            // Scripts/sync-registries.sh. They exist so a test can prove the
            // typed Swift keys still match the contract.
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "CountryFlagsInfrastructureTests",
            dependencies: ["CountryFlagsInfrastructure"]
        ),
        .testTarget(
            name: "CountryFlagsFeaturesTests",
            dependencies: ["CountryFlagsFeatures"]
        ),
    ]
)
