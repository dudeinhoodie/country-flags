import UIKit
import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure
import CountryFlagsMockBackend

final class AssetCacheTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = URL(filePath: NSTemporaryDirectory())
            .appending(path: "asset-cache-tests-\(UUID().uuidString)")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testVerifiedBytesAreReturnedAndCached() async throws {
        let payload = Data("<svg/>".utf8)
        let asset = Self.asset(sha256: FileAssetCache.digest(of: payload))
        let fetcher = RecordingAssetFetcher(bytes: [asset.url: payload])
        let cache = FileAssetCache(directory: directory, fetcher: fetcher)

        let first = try await cache.data(for: asset)
        let second = try await cache.data(for: asset)

        XCTAssertEqual(first, payload)
        XCTAssertEqual(second, payload)
        // The second read is served from disk: an asset is downloaded once.
        let requests = await fetcher.requests()
        XCTAssertEqual(requests, [asset.url])
    }

    /// Bytes that do not hash to what the release published are refused. Either
    /// the CDN is serving something else or the release is wrong, and neither
    /// is safe to draw as a flag.
    func testBytesThatDoNotMatchTheChecksumAreRefused() async throws {
        let asset = Self.asset(sha256: String(repeating: "a", count: 64))
        let fetcher = RecordingAssetFetcher(bytes: [asset.url: Data("<svg/>".utf8)])
        let cache = FileAssetCache(directory: directory, fetcher: fetcher)

        do {
            _ = try await cache.data(for: asset)
            XCTFail("Expected a checksum mismatch")
        } catch {
            XCTAssertEqual(error as? AssetCacheError, .checksumMismatch(assetID: asset.id))
        }
        // Nothing unusable is left behind for the next launch to trust.
        let cached = await cache.cachedData(for: asset)
        XCTAssertNil(cached)
    }

    func testAnUnreachableAssetIsReportedAsUnavailable() async throws {
        let asset = Self.asset(sha256: String(repeating: "b", count: 64))
        let cache = FileAssetCache(
            directory: directory,
            fetcher: RecordingAssetFetcher(failures: [asset.url])
        )

        do {
            _ = try await cache.data(for: asset)
            XCTFail("Expected the asset to be unavailable")
        } catch {
            XCTAssertEqual(error as? AssetCacheError, .unavailable(assetID: asset.id))
        }
    }

    func testCachedDataIsEmptyBeforeAnythingIsDownloaded() async throws {
        let asset = Self.asset(sha256: String(repeating: "c", count: 64))
        let cache = FileAssetCache(directory: directory, fetcher: RecordingAssetFetcher())

        let cached = await cache.cachedData(for: asset)

        XCTAssertNil(cached)
    }

    /// A file that was corrupted on disk is treated as absent rather than
    /// rendered: downloading again is cheaper than showing the wrong flag.
    func testACorruptedCacheFileIsDiscarded() async throws {
        let payload = Data("<svg/>".utf8)
        let asset = Self.asset(sha256: FileAssetCache.digest(of: payload))
        let cache = FileAssetCache(
            directory: directory,
            fetcher: RecordingAssetFetcher(bytes: [asset.url: payload])
        )
        _ = try await cache.data(for: asset)

        try Data("tampered".utf8).write(to: directory.appending(path: asset.sha256))

        let cached = await cache.cachedData(for: asset)
        XCTAssertNil(cached)
    }

    /// Eviction must not take the flags an unfinished session is going to show.
    func testEvictionKeepsWhatIsPinned() async throws {
        let keptPayload = Data("<svg id=\"kept\"/>".utf8)
        let droppedPayload = Data("<svg id=\"dropped\"/>".utf8)
        let kept = Self.asset(sha256: FileAssetCache.digest(of: keptPayload), path: "kept")
        let dropped = Self.asset(sha256: FileAssetCache.digest(of: droppedPayload), path: "dropped")
        let cache = FileAssetCache(
            directory: directory,
            fetcher: RecordingAssetFetcher(bytes: [
                kept.url: keptPayload,
                dropped.url: droppedPayload,
            ])
        )
        _ = try await cache.data(for: kept)
        _ = try await cache.data(for: dropped)

        await cache.evict(keepingChecksums: [kept.sha256])

        let keptData = await cache.cachedData(for: kept)
        let droppedData = await cache.cachedData(for: dropped)
        XCTAssertEqual(keptData, keptPayload)
        XCTAssertNil(droppedData)
    }

    /// The Mock build must serve flags whose checksums it actually honours,
    /// otherwise the mock only proves that verification is skipped.
    func testTheMockFlagsMatchTheChecksumsTheMockPayloadDeclares() async throws {
        let cache = FileAssetCache(directory: directory, fetcher: SyntheticAssetFetcher())

        for flag in SyntheticContent.flags {
            let record = AssetRecord(
                id: UUID(uuidString: flag.assetID)!,
                type: "FLAG",
                url: flag.url,
                mimeType: "image/svg+xml",
                sha256: flag.sha256,
                contentVersion: SyntheticContent.contentVersion
            )
            let data = try await cache.data(for: record)
            XCTAssertFalse(data.isEmpty, flag.name)
        }
    }

    private static func asset(sha256: String, path: String = "flag") -> AssetRecord {
        AssetRecord(
            id: UUID(),
            type: "FLAG",
            url: URL(string: "https://cdn.test.invalid/\(path).svg")!,
            mimeType: "image/svg+xml",
            sha256: sha256,
            contentVersion: "v1"
        )
    }
}

/// The assertion #82 showed was missing everywhere: bytes that download and
/// match their checksum still have to become a picture.
///
/// `AssetCacheTests` proved the transfer; nothing proved the result was
/// renderable, which is how a release of SVG-only assets reached the screen as
/// a placeholder on every card.
final class AssetRenderabilityTests: XCTestCase {
    func testEveryMockAssetDecodesIntoAnImage() async throws {
        let directory = URL(filePath: NSTemporaryDirectory())
            .appending(path: "asset-renderability-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = FileAssetCache(directory: directory, fetcher: SyntheticAssetFetcher())

        for flag in SyntheticContent.flags {
            let record = AssetRecord(
                id: UUID(uuidString: flag.assetID)!,
                type: "FLAG",
                url: flag.url,
                mimeType: "image/png",
                sha256: flag.sha256,
                contentVersion: SyntheticContent.contentVersion
            )

            let data = try await cache.data(for: record)
            XCTAssertNotNil(
                UIImage(data: data),
                "\(flag.name) downloaded and verified but could not be rendered"
            )
        }
    }

    /// The whole chain the release depends on: a payload that leads with a
    /// vector, the representation this build picks out of it, the download, the
    /// checksum of the bytes that actually arrived, and a picture at the end.
    ///
    /// The steps are each covered on their own; only together do they answer
    /// the question issue #82 asked, which is whether a flag reaches the screen.
    func testTheChosenRepresentationOfEveryPublishedAssetDecodes() async throws {
        let transport = MockClientTransport()
        await transport.always(SyntheticContent.deckCardsResponse(), for: "listDeckCards")
        let directory = URL(filePath: NSTemporaryDirectory())
            .appending(path: "asset-renderability-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = FileAssetCache(directory: directory, fetcher: SyntheticAssetFetcher())

        let page = try await ContentTestClient.makeService(transport: transport)
            .cards(inDeck: UUID(), locale: "ru", supportedTemplateSchemaVersions: [1])

        XCTAssertEqual(page.assets.count, SyntheticContent.flags.count)
        XCTAssertTrue(page.unsupportedCardIDs.isEmpty)
        for asset in page.assets {
            XCTAssertEqual(asset.mimeType, "image/png", "the vector was chosen over the raster")
            let data = try await cache.data(for: asset)
            XCTAssertNotNil(
                UIImage(data: data),
                "\(asset.url.lastPathComponent) downloaded and verified but could not be rendered"
            )
        }
    }

    /// The failure this guards against, stated directly: SVG is a valid asset
    /// the platform simply cannot turn into a `UIImage`.
    func testSVGBytesAreNotRenderable() {
        let svg = """
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 60">\
            <rect width="90" height="60" fill="#0055A4"/></svg>
            """

        XCTAssertNil(UIImage(data: Data(svg.utf8)))
    }
}
