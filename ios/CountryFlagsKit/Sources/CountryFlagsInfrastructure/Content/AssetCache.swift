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

/// What a cached asset is filed under.
///
/// The checksum on its own was enough while an entity had a single drawing.
/// It is not now: a country has a flag and a coat of arms at the same time,
/// and a key that named only the bytes would let one asset type land on
/// another's file — two symbols that happen to be published as identical
/// bytes would share one entry, and evicting either would take both. The
/// identifier and the type are in the key so the two cannot meet; the checksum
/// stays in it so a re-published drawing is a new file rather than a stale
/// hit.
public struct AssetCacheKey: Hashable, Sendable {
    public let assetID: UUID
    public let type: String
    public let sha256: String

    public init(asset: AssetRecord) {
        assetID = asset.id
        type = asset.type
        sha256 = asset.sha256
    }

    /// The name the bytes are stored under.
    ///
    /// The type comes from the content pipeline and is not a file name, so it
    /// is reduced to characters every file system takes. Two types that
    /// reduced to the same text would still be told apart by the identifier
    /// in front of it.
    var storageName: String {
        "\(assetID.uuidString.lowercased())-\(Self.slug(type))-\(sha256.lowercased())"
    }

    private static func slug(_ value: String) -> String {
        let reduced = value.unicodeScalars.map { scalar in
            CharacterSet.alphanumerics.contains(scalar) ? Character(scalar) : "-"
        }
        return String(reduced.prefix(64)).lowercased()
    }
}

/// `AssetLoading` plus the eviction only the owner of the files can do.
public protocol AssetCaching: AssetLoading {
    /// Drops cached files that nothing needs.
    ///
    /// - Parameter pinned: every asset that must survive, which is how a
    ///   session still in progress keeps the drawings it is going to show.
    ///   Assets are pinned whole rather than by checksum: the checksum no
    ///   longer names a file on its own.
    func evict(keeping pinned: Set<AssetCacheKey>) async

    /// Drops the bytes of assets that have gone from the store.
    ///
    /// The counterpart of `evict(keeping:)` for the case where the caller
    /// knows exactly what left rather than exactly what stays: an entitlement
    /// that goes takes a known handful of drawings with it, and enumerating
    /// everything that survives to express that would be the whole catalogue.
    func remove(_ assets: [AssetRecord]) async
}

/// Stores verified asset bytes on disk under the asset's identifier, its type
/// and the checksum the content release published.
///
/// Keeping the checksum in the key is what makes a re-published flag land as a
/// new file instead of a stale hit. Keeping the identifier and the type there
/// as well is what stops a coat of arms from being served where a flag was
/// asked for.
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

        // Coalesced on the same key the file is stored under: two views
        // asking for one flag at the same moment share a request, while a
        // flag and a coat published as identical bytes do not — they are two
        // assets with two URLs, and only one of them would be downloaded.
        let key = AssetCacheKey(asset: asset).storageName
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

        guard Self.digest(of: data) == asset.sha256.lowercased() else {
            // A mismatch is not a network hiccup: either the CDN is serving
            // something else or the release is wrong. Neither is safe to draw
            // as a flag, and both are worth a diagnostic.
            report(asset: asset, reason: "checksumMismatch")
            throw AssetCacheError.checksumMismatch(assetID: asset.id)
        }

        store(data, for: asset)
        return data
    }

    public func remove(_ assets: [AssetRecord]) async {
        for asset in assets {
            try? fileManager.removeItem(at: fileURL(for: asset))
        }
    }

    public func evict(keeping pinned: Set<AssetCacheKey>) async {
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
        let kept = Set(pinned.map(\.storageName))
        for file in files where !kept.contains(file.lastPathComponent) {
            try? fileManager.removeItem(at: file)
        }
    }

    // MARK: - Disk

    private func fileURL(for asset: AssetRecord) -> URL {
        directory.appending(path: AssetCacheKey(asset: asset).storageName)
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
