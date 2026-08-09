import Foundation

/// Supplies the verified bytes of a content asset.
///
/// It is declared here, next to `AssetRecord`, so a view can draw a flag
/// without importing the layer that owns URLSession and the on-disk cache.
/// Whoever implements it is responsible for checking the checksum: a caller
/// that receives bytes from here may render them.
public protocol AssetLoading: Sendable {
    /// Verified bytes, downloading them if they are not on the device yet.
    func data(for asset: AssetRecord) async throws -> Data
    /// Verified bytes already on the device, or nil. Never reaches the network,
    /// so a view can draw what it has before deciding to wait.
    func cachedData(for asset: AssetRecord) async -> Data?
}
