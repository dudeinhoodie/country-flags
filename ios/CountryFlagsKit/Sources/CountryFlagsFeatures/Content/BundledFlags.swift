import Foundation
import SwiftUI

import CountryFlagsDomain

/// The flags this build ships, indexed by the checksum of every encoding the
/// release published for them.
///
/// The index is keyed by content rather than by country, which is what makes a
/// correction work: a changed flag has different bytes, none of its checksums
/// are here, and the client downloads it instead. See
/// `docs/adr/ADR-011-bundled-flag-baseline.md`.
///
/// Both the catalog and the index are generated from one content release by
/// `ios/Scripts/sync-flag-assets.mjs`, so a build cannot ship an image no
/// release published.
struct BundledFlags: Sendable {
    /// The release the bundled set was generated from.
    let contentVersion: String
    private let assetNames: [String: String]

    static let shipped = BundledFlags()

    /// Where the catalog and the index live. Exposed so a test can look an
    /// image up in the same bundle the app draws from rather than its own.
    static let resourceBundle: Bundle = .module

    /// - Parameter bundle: the resource bundle holding `BundledFlags.json` and
    ///   the matching asset catalog.
    init(bundle: Bundle = .module) {
        // A missing index degrades to downloading every flag, which is the
        // behaviour that predates this file rather than a broken screen. The
        // tests are what guarantee a release actually ships the set.
        guard
            let url = bundle.url(forResource: "BundledFlags", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let index = try? JSONDecoder().decode(Index.self, from: data)
        else {
            contentVersion = ""
            assetNames = [:]
            return
        }
        contentVersion = index.contentVersion
        assetNames = index.assetNames
    }

    /// The asset catalog name for a published checksum, or nil when this build
    /// does not ship that image.
    func assetName(forChecksum sha256: String) -> String? {
        assetNames[sha256.lowercased()]
    }

    /// Every image the catalog is expected to contain, deduplicated: territories
    /// flying an identical file share one entry.
    var assetNameSet: Set<String> {
        Set(assetNames.values)
    }

    var isEmpty: Bool { assetNames.isEmpty }

    private struct Index: Decodable {
        let contentVersion: String
        let assetNames: [String: String]
    }
}

/// Decides where a flag comes from and produces the image to draw.
///
/// Separated from the view so the rule is testable: a bundled flag must not
/// reach the asset cache at all, and a flag this build does not ship must.
struct FlagImageResolver: Sendable {
    let bundled: BundledFlags
    let assets: any AssetLoading

    init(assets: any AssetLoading, bundled: BundledFlags = .shipped) {
        self.assets = assets
        self.bundled = bundled
    }

    /// - Parameter pixelWidth: the width in pixels the flag will be drawn at,
    ///   when it is small and known. The flag then comes from a copy decoded
    ///   at that size rather than from the full image.
    /// - Returns: nil when the flag cannot be drawn at all, which is the
    ///   placeholder's case.
    func image(for record: AssetRecord, pixelWidth: CGFloat? = nil) async -> Image? {
        if let name = bundled.assetName(forChecksum: record.sha256) {
            guard let pixelWidth, let full = UIImage(named: name, in: .module, with: nil) else {
                return Image(name, bundle: .module)
            }
            return await Self.thumbnail(of: full, pixelWidth: pixelWidth)
        }
        guard let data = try? await assets.data(for: record),
            let platformImage = UIImage(data: data)
        else {
            return nil
        }
        guard let pixelWidth else { return Image(uiImage: platformImage) }
        return await Self.thumbnail(of: platformImage, pixelWidth: pixelWidth)
    }

    /// A copy of the flag at the size it is drawn (#555).
    ///
    /// The catalog's flags are 1080 pixels wide, and a row draws them in 132:
    /// left to the drawing, that eight-fold reduction samples too few of the
    /// source's pixels, and a flag's thin lines come out hard and uneven. The
    /// thumbnail is filtered properly, once, off the main thread, and holds
    /// far less memory. It falls back to the full image rather than to the
    /// placeholder, which would claim the flag is missing.
    private static func thumbnail(of image: UIImage, pixelWidth: CGFloat) async -> Image {
        let ratio = image.size.width > 0 ? image.size.height / image.size.width : 0
        let size = CGSize(width: pixelWidth, height: pixelWidth * ratio)
        let reduced = await image.byPreparingThumbnail(ofSize: size)
        return Image(uiImage: reduced ?? image)
    }
}
