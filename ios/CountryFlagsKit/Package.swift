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
        .package(url: "https://github.com/google/GoogleSignIn-iOS", from: "8.0.0"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.1.0"),
        // The evaluation API only. The provider is ours: the backend evaluates
        // the rules, so no control plane SDK is linked into the app.
        .package(url: "https://github.com/open-feature/swift-sdk", from: "0.5.0"),
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
            // Copied rather than processed: the mock reads the documents by
            // name out of their directory, and processing would flatten it.
            resources: [.copy("Resources/MockContent")],
            plugins: [
                .plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")
            ]
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
            dependencies: ["CountryFlagsInfrastructure"]
        ),
        .testTarget(
            name: "CountryFlagsFeaturesTests",
            dependencies: ["CountryFlagsFeatures"]
        ),
    ]
)
