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

    /// One published encoding of an asset, reduced to what the choice depends
    /// on. The generated type stays in the mapper; this is the part worth
    /// testing on its own.
    struct Candidate: Hashable, Sendable {
        let mimeType: String
        /// The screen scale the raster was rendered for. Nil for the vector,
        /// which has no fixed scale.
        let scale: Double?

        init(mimeType: String, scale: Double?) {
            self.mimeType = mimeType
            self.scale = scale
        }
    }

    /// Which encoding to draw on a screen of this scale.
    ///
    /// The rule used to be "the first one that decodes", which is the `@2x`
    /// PNG in publication order — so a 3x phone drew every flag from a file
    /// with less than half the pixels it has, most visibly on the study prompt
    /// where a flag is 120 points wide. The `@3x` file was published and sat
    /// unused.
    ///
    /// In order: the scale this screen actually is, then the largest one below
    /// it, then whatever decodes at all. The last step is what keeps a release
    /// with no scales, or with only larger ones, rendering rather than falling
    /// through to the vector this platform cannot draw.
    ///
    /// - Returns: the index of the chosen candidate, or nil when none of them
    ///   can be drawn.
    static func choose(from candidates: [Candidate], displayScale: Double) -> Int? {
        let renderable = candidates.enumerated().filter { canRender($0.element.mimeType) }
        guard !renderable.isEmpty else { return nil }

        if let exact = renderable.first(where: { $0.element.scale == displayScale }) {
            return exact.offset
        }
        let below = renderable
            .filter { ($0.element.scale ?? 0) < displayScale }
            .max { ($0.element.scale ?? 0) < ($1.element.scale ?? 0) }
        if let below, below.element.scale != nil {
            return below.offset
        }
        return renderable[0].offset
    }
}
