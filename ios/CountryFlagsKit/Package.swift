// swift-tools-version: 6.0
import PackageDescription

// Логика приложения живёт здесь; app target остаётся composition root.
// Дополнительный target добавляется только при доказанной compile-time или
// ownership необходимости.
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
        // Не импортирует SwiftUI, SwiftData, OpenFeature и OAuth SDK.
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
