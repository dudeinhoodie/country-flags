import SwiftUI

import CountryFlagsDomain

/// Countries met at all, as a small tile (#512).
///
/// One of the three blocks the design language lets carry colour (#510): its
/// ground is a blurred mosaic of the flags the learner has met, under a shade
/// dark enough for the figure. The mosaic is a picture of the number, never a
/// second number: which flags it shows comes from the cards on this phone,
/// and the figure is the backend's (ADR-016).
struct HomeKnownTile: View {
    let known: Int
    let flags: [LearningCardRecord]
    let store: ContentStore
    let assets: (any AssetLoading)?

    var body: some View {
        HomeFigureTile(value: known, caption: L10n.homeKnownCaption(known)) {
            Image(systemName: "flag.fill")
                .resizable()
                .scaledToFit()
                .foregroundStyle(.white)
                .frame(width: 24, height: 26)
                .padding(-2)
        } ground: {
            ZStack {
                DesignTokens.Colors.flatSurface
                if let assets, !flags.isEmpty {
                    FlagMosaic(flags: flags, store: store, assets: assets)
                }
                LinearGradient(
                    colors: [.black.opacity(0.12), .black.opacity(0.6)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
        }
    }
}

/// Countries learned, as a small tile (#512): green, with the seal large and
/// faint behind the figure. At zero it is quiet glass with a dashed green
/// edge — present, and plainly not yet.
struct HomeLearnedTile: View {
    let learned: Int

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        HomeFigureTile(
            value: learned,
            caption: L10n.homeLearnedCaption,
            tint: learned > 0 ? .white : .white.opacity(0.35)
        ) {
            Image(systemName: "checkmark.seal.fill")
                .resizable()
                .scaledToFit()
                .symbolRenderingMode(.palette)
                .foregroundStyle(
                    learned > 0 ? Self.darkGreen : .black.opacity(0.75),
                    learned > 0 ? Color.white : DesignTokens.Colors.learned
                )
                .frame(width: 34, height: 34)
                .padding(-6)
        } ground: {
            if learned > 0 {
                ZStack {
                    LinearGradient(
                        colors: [DesignTokens.Colors.learned, Self.darkGreen],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    Image(systemName: "checkmark.seal.fill")
                        .resizable()
                        .scaledToFit()
                        .foregroundStyle(.white.opacity(0.14))
                        .frame(width: Self.watermark, height: Self.watermark)
                        .rotationEffect(.degrees(-14))
                        .offset(x: Self.watermark * 0.36, y: Self.watermark * 0.3)
                }
            } else {
                Color.white.opacity(0.06)
                    .overlay {
                        RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
                            .strokeBorder(
                                DesignTokens.Colors.learned.opacity(0.55),
                                style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])
                            )
                    }
            }
        }
    }

    /// The far end of the tile's green, and the seal's tick on it.
    private static let darkGreen = Color(.sRGB, red: 13 / 255, green: 92 / 255, blue: 38 / 255)
    /// The faint seal behind the figure, larger than the tile is tall so only
    /// part of it shows.
    private static let watermark: CGFloat = 170
}

/// The shape both figure tiles share: a symbol at the top, the figure and its
/// word at the bottom, a ground of the caller's choosing, the large radius.
///
/// The symbols are drawn large (#556), and each one's negative padding lets it
/// reach past the tile's inset by what it is larger than the other. Both then
/// take the same 22 points of the column, so the figures line up across the
/// two tiles.
private struct HomeFigureTile<Symbol: View, Ground: View>: View {
    let value: Int
    let caption: String
    var tint: Color = .white
    @ViewBuilder let symbol: Symbol
    @ViewBuilder let ground: Ground

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            symbol
                .accessibilityHidden(true)

            Spacer(minLength: DesignTokens.Spacing.medium)

            Text("\(value)")
                .font(DesignTokens.Typography.heroNumber)
                .monospacedDigit()
                .contentTransition(.numericText())
                .foregroundStyle(tint)
            Text(caption)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.white.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(
            maxWidth: .infinity,
            minHeight: DesignTokens.Layout.homeTileContentHeight,
            alignment: .leading
        )
        .padding(DesignTokens.Spacing.medium)
        .background { ground }
        .clipShape(shape)
        .overlay {
            shape.strokeBorder(
                .white.opacity(DesignTokens.Card.borderOpacity),
                lineWidth: 1 / displayScale
            )
        }
    }
}

/// The known tile's ground: the flags met, four to a row, blurred until they
/// are colour rather than flags.
private struct FlagMosaic: View {
    let flags: [LearningCardRecord]
    let store: ContentStore
    let assets: any AssetLoading

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 4), spacing: 0) {
            ForEach(Array(filled.enumerated()), id: \.offset) { _, card in
                FlagImageView(
                    assetID: card.promptAssetID,
                    accessibilityLabel: card.displayName,
                    store: store,
                    assets: assets,
                    contentMode: .fill
                )
                .aspectRatio(DesignTokens.Card.aspectRatio, contentMode: .fill)
                .clipped()
            }
        }
        .scaleEffect(1.15)
        .blur(radius: 14)
        .saturation(1.35)
        .accessibilityHidden(true)
    }

    /// Sixteen cells whatever the count: a learner with three known flags
    /// still gets a full ground, made of those three.
    private var filled: [LearningCardRecord] {
        guard !flags.isEmpty else { return [] }
        return (0..<16).map { flags[$0 % flags.count] }
    }
}
