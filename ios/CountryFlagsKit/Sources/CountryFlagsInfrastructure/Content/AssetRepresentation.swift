import Foundation

/// Which encodings of an asset this build can turn into a picture.
///
/// A release publishes several — the vector original first, then raster — and
/// leaves the choice to the client, because only the client knows what it can
/// decode. `UIImage(data:)` decodes raster bytes and returns nil for SVG, which
/// iOS reads from an asset catalogue and never from bytes a release downloads.
/// A catalogue of SVG alone therefore draws the placeholder everywhere, which
/// is what issue #82 was.
enum RenderableRepresentation {
    /// Media types `UIImage(data:)` decodes from downloaded bytes.
    ///
    /// The contract also carries `image/svg+xml`, which is deliberately absent:
    /// it is a valid asset this platform cannot draw.
    static let mimeTypes: Set<String> = ["image/png", "image/jpeg", "image/webp"]

    static func canRender(_ mimeType: String) -> Bool {
        mimeTypes.contains(mimeType.lowercased())
    }
}
