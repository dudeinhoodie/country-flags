import CryptoKit
import Foundation

import CountryFlagsDomain

public enum AssetCacheError: Error, Equatable, Sendable {
    /// The bytes that arrived are not the bytes the content release describes.
    case checksumMismatch(assetID: UUID)
    case unavailable(assetID: UUID)
}

/// Where asset bytes come from. Separated so a test can answer without a
/// socket, which is what keeps the cache's own rules testable.
public protocol AssetDataFetching: Sendable {
    func data(from url: URL) async throws -> Data
}

public struct URLSessionAssetFetcher: AssetDataFetching {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func data(from url: URL) async throws -> Data {
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.transport("The asset request was refused")
        }
        return data
    }
}

/// `AssetLoading` plus the eviction only the owner of the files can do.
public protocol AssetCaching: AssetLoading {
    /// Drops cached files that nothing needs.
    ///
    /// - Parameter pinnedChecksums: the `sha256` of every asset that must
    ///   survive, which is how a session still in progress keeps the flags it
    ///   is going to show. Files are stored under their checksum, so that is
    ///   what the caller pins.
    func evict(keepingChecksums pinnedChecksums: Set<String>) async
}

/// Stores verified asset bytes on disk, keyed by the checksum the content
/// release published.
///
/// Keying by checksum rather than by asset identifier is what makes a
/// re-published flag land as a new file instead of a stale hit, and what lets
/// the same bytes serve two records that share them.
public actor FileAssetCache: AssetCaching {
    private let directory: URL
    private let fetcher: any AssetDataFetching
    private let fileManager: FileManager
    private let logger: any AppLogging

    /// Downloads already running, so two views asking for the same flag at the
    /// same moment share one request rather than racing.
    private var inFlight: [String: Task<Data, any Error>] = [:]

    public init(
        directory: URL,
        fetcher: any AssetDataFetching = URLSessionAssetFetcher(),
        fileManager: FileManager = .default,
        logger: any AppLogging = NoOpLogger()
    ) {
        self.directory = directory
        self.fetcher = fetcher
        self.fileManager = fileManager
        self.logger = logger
    }

    /// The default location: caches, because every byte here can be downloaded
    /// again and none of it is the user's own data.
    public static func defaultDirectory(
        fileManager: FileManager = .default,
        name: String = "content-assets"
    ) -> URL {
        let base =
            fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return base.appending(path: name)
    }

    public func cachedData(for asset: AssetRecord) async -> Data? {
        guard let data = try? Data(contentsOf: fileURL(for: asset)) else { return nil }
        // A file that no longer matches its checksum is treated as absent: it
        // is cheaper to download again than to render something that is not
        // the flag the release published.
        guard Self.digest(of: data) == asset.sha256.lowercased() else {
            try? fileManager.removeItem(at: fileURL(for: asset))
            return nil
        }
        return data
    }

    public func data(for asset: AssetRecord) async throws -> Data {
        if let cached = await cachedData(for: asset) {
            return cached
        }

        let key = asset.sha256.lowercased()
        if let running = inFlight[key] {
            return try await running.value
        }

        let task = Task<Data, any Error> { [fetcher] in
            try await fetcher.data(from: asset.url)
        }
        inFlight[key] = task
        defer { inFlight[key] = nil }

        let data: Data
        do {
            data = try await task.value
        } catch {
            report(asset: asset, reason: "unreachable")
            throw AssetCacheError.unavailable(assetID: asset.id)
        }

        guard Self.digest(of: data) == key else {
            // A mismatch is not a network hiccup: either the CDN is serving
            // something else or the release is wrong. Neither is safe to draw
            // as a flag, and both are worth a diagnostic.
            report(asset: asset, reason: "checksumMismatch")
            throw AssetCacheError.checksumMismatch(assetID: asset.id)
        }

        store(data, for: asset)
        return data
    }

    public func evict(keepingChecksums pinnedChecksums: Set<String>) async {
        // Nothing is removed while it might still be needed: the caller names
        // what an unfinished session is holding, and only the rest goes.
        guard
            let files = try? fileManager.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: nil
            )
        else {
            return
        }
        let pinned = Set(pinnedChecksums.map { $0.lowercased() })
        for file in files where !pinned.contains(file.lastPathComponent) {
            try? fileManager.removeItem(at: file)
        }
    }

    // MARK: - Disk

    private func fileURL(for asset: AssetRecord) -> URL {
        directory.appending(path: asset.sha256.lowercased())
    }

    private func store(_ data: Data, for asset: AssetRecord) {
        do {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: fileURL(for: asset), options: .atomic)
        } catch {
            // A cache that cannot write still serves the bytes it just
            // verified; the next launch simply downloads them again.
            logger.log(
                .notice,
                .content,
                "Could not cache an asset on disk",
                ["assetId": .safe(asset.id.uuidString)]
            )
        }
    }

    /// The diagnostic behind the placeholder.
    ///
    /// It goes to the log rather than to `DiagnosticsReporting`, which carries
    /// crash and hang reports: an asset that will not render is a content
    /// problem, and the log is where the content category is already read.
    private func report(asset: AssetRecord, reason: String) {
        logger.log(
            .error,
            .content,
            "An asset could not be used",
            ["assetId": .safe(asset.id.uuidString), "reason": .safe(reason)]
        )
    }

    static func digest(of data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
