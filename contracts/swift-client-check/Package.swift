// swift-tools-version:6.0
import PackageDescription

// Minimal reproducible check that the canonical bundled contract compiles with
// the official Apple generator and that unknown enum values stay decodable.
let package = Package(
    name: "CountryFlagsClientCheck",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.9.0"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.0"),
    ],
    targets: [
        .target(
            name: "CountryFlagsAPI",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime")
            ],
            plugins: [
                .plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")
            ]
        ),
        .testTarget(name: "CountryFlagsAPITests", dependencies: ["CountryFlagsAPI"]),
    ]
)
