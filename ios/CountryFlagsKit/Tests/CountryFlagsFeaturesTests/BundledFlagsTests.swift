import SwiftUI
import UIKit
import XCTest

import CountryFlagsDomain

@testable import CountryFlagsFeatures

/// Counts what reached the asset cache, so a test can prove a bundled flag
/// never did.
private final class RecordingAssetLoader: AssetLoading, @unchecked Sendable {
    private let bytes: Data?
    private(set) var requestedChecksums: [String] = []

    init(bytes: Data? = nil) {
        self.bytes = bytes
    }

    func data(for asset: AssetRecord) async throws -> Data {
        requestedChecksums.append(asset.sha256)
        guard let bytes else { throw AssetCacheStub.unavailable }
        return bytes
    }

    func cachedData(for asset: AssetRecord) async -> Data? {
        requestedChecksums.append(asset.sha256)
        return bytes
    }
}

private enum AssetCacheStub: Error {
    case unavailable
}

private func assetRecord(sha256: String) -> AssetRecord {
    AssetRecord(
        id: UUID(),
        type: "FLAG",
        url: URL(string: "https://cdn.test/flags/example.png")!,
        mimeType: "image/png",
        sha256: sha256,
        contentVersion: "test"
    )
}

private func onePixelPNG() -> Data {
    UIGraphicsImageRenderer(size: CGSize(width: 1, height: 1)).pngData { context in
        UIColor.red.setFill()
        context.fill(CGRect(x: 0, y: 0, width: 1, height: 1))
    }
}

/// The published registry the bundled set was generated from, read from the
/// repository so a test asserts against the same document the generator did.
private enum ContentFixture {
    struct Registry: Decodable {
        struct Asset: Decodable {
            struct Representation: Decodable {
                let mimeType: String
                let sha256: String
            }

            let key: String
            let representations: [Representation]
        }

        let assets: [Asset]
    }

    static func assetRegistry() throws -> Registry {
        let url = repositoryRoot.appending(
            path: "content/generated/fixture-v1/assets/assets.json"
        )
        return try JSONDecoder().decode(Registry.self, from: Data(contentsOf: url))
    }

    /// This file sits at `ios/CountryFlagsKit/Tests/CountryFlagsFeaturesTests/`.
    private static let repositoryRoot: URL = URL(filePath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
}

final class BundledFlagsTests: XCTestCase {
    private let bundled = BundledFlags.shipped

    /// A release that ships no flags would send every launch to the network,
    /// which is the state ADR-011 exists to end.
    func testTheBuildShipsTheFlagsOfOneRelease() {
        XCTAssertFalse(bundled.isEmpty)
        XCTAssertEqual(bundled.contentVersion, "fixture-v1")
        XCTAssertEqual(bundled.assetNameSet.count, 250)
    }

    /// The index and the catalog are generated together, so a name that does
    /// not resolve means the build shipped one without the other.
    func testEveryIndexedNameResolvesToARealImage() {
        for name in bundled.assetNameSet {
            XCTAssertNotNil(
                UIImage(named: name, in: BundledFlags.resourceBundle, compatibleWith: nil),
                "\(name) is indexed but not in the catalog"
            )
        }
    }

    /// Every encoding of every shipped flag points at an image: the client
    /// stores whichever representation it chose, and all of them have to hit.
    func testEveryPublishedEncodingOfAShippedFlagIsIndexed() throws {
        let registry = try ContentFixture.assetRegistry()
        XCTAssertEqual(registry.assets.count, 250)
        for asset in registry.assets {
            for representation in asset.representations {
                XCTAssertNotNil(
                    bundled.assetName(forChecksum: representation.sha256),
                    "\(asset.key) publishes \(representation.mimeType) unindexed"
                )
            }
        }
    }

    /// The release publishes the French tricolour for France and for nine of
    /// its territories, and their raster encodings are one file. Identical
    /// bytes are the identical picture, so a single entry draws the right flag
    /// for all of them and which name it carries is an implementation detail.
    func testTerritoriesFlyingAnIdenticalFileShareOneBundledImage() throws {
        let registry = try ContentFixture.assetRegistry()
        let france = try rasterChecksum(of: "flag.france.current", in: registry)
        let wallis = try rasterChecksum(
            of: "flag.wallis-and-futuna-islands.current",
            in: registry
        )

        XCTAssertEqual(france, wallis, "the release no longer publishes one file for both")
        XCTAssertNotNil(bundled.assetName(forChecksum: france))
        XCTAssertEqual(
            bundled.assetName(forChecksum: france),
            bundled.assetName(forChecksum: wallis)
        )
    }

    func testAnUnknownChecksumIsNotBundled() {
        XCTAssertNil(bundled.assetName(forChecksum: String(repeating: "a", count: 64)))
    }

    // MARK: - Resolution

    /// The point of the baseline: a flag this build ships is drawn without the
    /// network and without populating the disk cache.
    func testAShippedFlagNeverReachesTheAssetCache() async throws {
        let registry = try ContentFixture.assetRegistry()
        let france = try rasterChecksum(of: "flag.france.current", in: registry)
        let loader = RecordingAssetLoader()

        let image = await FlagImageResolver(assets: loader, bundled: bundled)
            .image(for: assetRecord(sha256: france))

        XCTAssertNotNil(image)
        XCTAssertTrue(loader.requestedChecksums.isEmpty)
    }

    /// A corrected flag has different bytes, so the baseline must not answer
    /// for it. This is what keeps a stale image from being drawn over a fix.
    func testAFlagThisBuildDoesNotShipIsDownloaded() async throws {
        let loader = RecordingAssetLoader(bytes: onePixelPNG())
        let corrected = String(repeating: "b", count: 64)

        let image = await FlagImageResolver(assets: loader, bundled: bundled)
            .image(for: assetRecord(sha256: corrected))

        XCTAssertNotNil(image)
        XCTAssertEqual(loader.requestedChecksums, [corrected])
    }

    /// Neither source produced a picture, which is the placeholder's case and
    /// the only one it is reserved for.
    func testAFlagThatIsNeitherShippedNorDownloadableHasNoImage() async {
        let loader = RecordingAssetLoader()

        let image = await FlagImageResolver(assets: loader, bundled: bundled)
            .image(for: assetRecord(sha256: String(repeating: "c", count: 64)))

        XCTAssertNil(image)
    }

    /// The checksum of the raster encoding, which is the one an iOS client
    /// actually stores: it cannot decode a downloaded SVG.
    private func rasterChecksum(
        of key: String,
        in registry: ContentFixture.Registry
    ) throws -> String {
        let asset = try XCTUnwrap(registry.assets.first { $0.key == key })
        return try XCTUnwrap(
            asset.representations.first { $0.mimeType == "image/png" }?.sha256
        )
    }
}
