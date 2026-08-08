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
    targets: [
        // Imports neither SwiftUI, SwiftData, OpenFeature nor an OAuth SDK.
        .target(name: "CountryFlagsDomain"),
        .target(
            name: "CountryFlagsInfrastructure",
            dependencies: ["CountryFlagsDomain"]
        ),
        .target(
            name: "CountryFlagsFeatures",
            dependencies: ["CountryFlagsDomain"],
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
