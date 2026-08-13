import SwiftUI
import UIKit

import CountryFlagsDomain

/// Two colours taken from a flag, used to light the scene behind it.
///
/// The scene is not decoration: it is how a card change reads from the corner
/// of the eye, before the flag itself is looked at. Taking the colours from the
/// artwork rather than from a hand-written table means a corrected flag brings
/// its own scene with it, and a country nobody thought about still gets one.
struct FlagPalette: Equatable, Sendable {
    let primary: Color
    let secondary: Color

    /// What a card without artwork gets: the app's own accent, quietly.
    static let neutral = FlagPalette(
        primary: Color.accentColor,
        secondary: Color.accentColor.opacity(0.6)
    )
}

enum FlagPaletteReader {
    /// Reads the two colours a flag is mostly made of.
    ///
    /// The image is drawn once into a grid a few pixels across, which is enough
    /// to find the fields of a flag and cheap enough to do while a card is
    /// being turned over. Pale pixels are counted but weighted down: almost
    /// every flag has white in it, and a scene lit by white is no scene at all.
    static func palette(
        for record: AssetRecord,
        assets: any AssetLoading,
        bundled: BundledFlags = .shipped
    ) async -> FlagPalette? {
        guard let image = await platformImage(for: record, assets: assets, bundled: bundled),
            let pixels = sample(image)
        else {
            return nil
        }
        return palette(from: pixels)
    }

    private static func platformImage(
        for record: AssetRecord,
        assets: any AssetLoading,
        bundled: BundledFlags
    ) async -> UIImage? {
        if let name = bundled.assetName(forChecksum: record.sha256),
            let shipped = UIImage(named: name, in: .module, with: nil) {
            return shipped
        }
        guard let data = try? await assets.data(for: record) else { return nil }
        return UIImage(data: data)
    }

    private static let grid = 12

    private static func sample(_ image: UIImage) -> [(r: CGFloat, g: CGFloat, b: CGFloat)]? {
        let side = grid
        var raw = [UInt8](repeating: 0, count: side * side * 4)
        guard let context = CGContext(
            data: &raw,
            width: side,
            height: side,
            bitsPerComponent: 8,
            bytesPerRow: side * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return nil
        }
        // A vector flag from the asset catalog has no CGImage until it is
        // drawn, so it is rendered rather than read.
        UIGraphicsPushContext(context)
        image.draw(in: CGRect(x: 0, y: 0, width: side, height: side))
        UIGraphicsPopContext()

        return stride(from: 0, to: raw.count, by: 4).compactMap { offset in
            let alpha = CGFloat(raw[offset + 3]) / 255
            guard alpha > 0.5 else { return nil }
            return (
                CGFloat(raw[offset]) / 255,
                CGFloat(raw[offset + 1]) / 255,
                CGFloat(raw[offset + 2]) / 255
            )
        }
    }

    private static func palette(
        from pixels: [(r: CGFloat, g: CGFloat, b: CGFloat)]
    ) -> FlagPalette? {
        guard !pixels.isEmpty else { return nil }

        // Buckets by hue, wide enough that the two reds of a tricolour do not
        // become two different answers.
        var weightByBucket: [Int: CGFloat] = [:]
        var sumByBucket: [Int: (r: CGFloat, g: CGFloat, b: CGFloat)] = [:]
        var countByBucket: [Int: CGFloat] = [:]

        for pixel in pixels {
            let maximum = max(pixel.r, pixel.g, pixel.b)
            let minimum = min(pixel.r, pixel.g, pixel.b)
            let saturation = maximum <= 0 ? 0 : (maximum - minimum) / maximum
            let bucket = hueBucket(pixel)
            // Saturation decides how much a pixel is allowed to speak, so a
            // white field never wins over a red one it is twice the size of.
            weightByBucket[bucket, default: 0] += 0.15 + saturation
            let sum = sumByBucket[bucket] ?? (0, 0, 0)
            sumByBucket[bucket] = (sum.r + pixel.r, sum.g + pixel.g, sum.b + pixel.b)
            countByBucket[bucket, default: 0] += 1
        }

        let ranked = weightByBucket.sorted { $0.value > $1.value }.map(\.key)
        guard let first = ranked.first else { return nil }
        let second = ranked.dropFirst().first ?? first

        return FlagPalette(
            primary: average(bucket: first, sums: sumByBucket, counts: countByBucket),
            secondary: average(bucket: second, sums: sumByBucket, counts: countByBucket)
        )
    }

    private static func hueBucket(_ pixel: (r: CGFloat, g: CGFloat, b: CGFloat)) -> Int {
        let maximum = max(pixel.r, pixel.g, pixel.b)
        let minimum = min(pixel.r, pixel.g, pixel.b)
        guard maximum > minimum else {
            // Greys carry no hue; they share one bucket rather than scattering.
            return -1
        }
        let delta = maximum - minimum
        let hue: CGFloat
        switch maximum {
        case pixel.r: hue = (pixel.g - pixel.b) / delta
        case pixel.g: hue = 2 + (pixel.b - pixel.r) / delta
        default: hue = 4 + (pixel.r - pixel.g) / delta
        }
        let degrees = (hue * 60).truncatingRemainder(dividingBy: 360)
        return Int((degrees < 0 ? degrees + 360 : degrees) / 40)
    }

    private static func average(
        bucket: Int,
        sums: [Int: (r: CGFloat, g: CGFloat, b: CGFloat)],
        counts: [Int: CGFloat]
    ) -> Color {
        guard let sum = sums[bucket], let count = counts[bucket], count > 0 else {
            return FlagPalette.neutral.primary
        }
        return Color(
            red: Double(sum.r / count),
            green: Double(sum.g / count),
            blue: Double(sum.b / count)
        )
    }
}
