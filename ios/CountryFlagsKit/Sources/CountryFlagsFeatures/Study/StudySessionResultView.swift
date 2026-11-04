import SwiftUI

import CountryFlagsDomain

/// The session's result, made of the session's own flags (#519).
///
/// The owner turned down the gauge and its percentage (2026-11-04) and chose,
/// after several rounds, a result that is the sitting itself: every flag
/// answered lies on the screen like a deck slid along a shallow arc, in rows
/// that overlap a little; each remembered flag carries the green seal, and a
/// missed one carries nothing — no red, no grade. Under the flags a sheet
/// gives three figures — known, learned, to review — and the way on: the next
/// portion, or done.
///
/// The figures are the device's count (`StudySessionTally`), as the ring
/// before them was: the sheet appears before the sitting's answers can reach
/// the backend, and Home shows the backend's figures once they have.
struct StudySessionResultView: View {
    let summary: StudySessionSummary
    let tally: StudySessionTally?
    let store: ContentStore
    let assets: any AssetLoading
    /// Starts the next portion of the same deck; nil hides the offer.
    let onMore: (() -> Void)?
    let onDone: () -> Void

    /// The flag lifted by a tap, showing its name.
    @State private var raised: Int?

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.medium) {
            // The agreed design has no visible title: the flags are the
            // result. The sentence is kept for VoiceOver, as the screen's
            // heading, and for the tests that recognise the screen by it.
            Text(L10n.studyResultTitle)
                .font(DesignTokens.Typography.caption)
                .frame(width: 1, height: 1)
                .opacity(0.001)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier(AccessibilityIdentifier.studyResultTitle)

            GeometryReader { geometry in
                let plan = ResultHeapLayout.plan(
                    seeds: summary.answered.map { ResultHeapLayout.seed(for: $0.promptAssetID) },
                    width: geometry.size.width
                )
                ScrollView(.vertical, showsIndicators: false) {
                    ZStack(alignment: .topLeading) {
                        ForEach(Array(summary.answered.enumerated()), id: \.offset) { index, card in
                            heapCard(card, at: plan.places[index], isRaised: raised == index)
                                .zIndex(raised == index ? Double(summary.answered.count) : Double(index))
                                .onTapGesture {
                                    withAnimation(.snappy) { raised = raised == index ? nil : index }
                                }
                        }
                    }
                    .frame(width: geometry.size.width, height: plan.height, alignment: .topLeading)
                }
                .scrollBounceBehavior(.basedOnSize)
            }
            // One element for VoiceOver: the flags are pictures of the
            // sentence, which says how many were remembered out of the plan
            // and how many come back.
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(rememberedSentence)
            .accessibilityIdentifier(AccessibilityIdentifier.studyResultAnswered)
            .devBlockID("result.heap")

            sheet
                .devBlockID("result.sheet")
        }
    }

    // MARK: - The flags

    private func heapCard(
        _ card: StudySessionSummary.AnsweredCard,
        at place: ResultHeapLayout.Place,
        isRaised: Bool
    ) -> some View {
        ResultCard(card: card, size: place.size, store: store, assets: assets)
            .overlay(alignment: .bottom) {
                if isRaised, !card.displayName.isEmpty {
                    Text(card.displayName)
                        .font(DesignTokens.Typography.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, DesignTokens.Spacing.small)
                        .padding(.vertical, DesignTokens.Spacing.extraSmall)
                        .background(.black.opacity(0.75), in: Capsule(style: .continuous))
                        .fixedSize()
                        .offset(y: DesignTokens.Spacing.large)
                }
            }
            .scaleEffect(isRaised ? 1.08 : 1)
            .rotationEffect(.degrees(isRaised ? 0 : place.rotation))
            .position(place.center)
    }

    private var rememberedSentence: String {
        var parts = [L10n.studyResultRemembered(summary.rememberedCards, summary.plannedCards)]
        let returning = summary.answeredCards - summary.rememberedCards
        if returning > 0 {
            parts.append(L10n.studyResultReturning(returning))
        }
        return parts.joined(separator: ", ")
    }

    // MARK: - The sheet

    private var sheet: some View {
        GlassCard(padding: DesignTokens.Spacing.large) {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.large) {
                if let tally {
                    HStack(alignment: .top, spacing: DesignTokens.Spacing.medium) {
                        figure(
                            tally.known,
                            gain: tally.knownGain,
                            gainTint: .white.opacity(0.6),
                            caption: L10n.homeKnownCaption(tally.known)
                        ) {
                            Image(systemName: "flag.fill").foregroundStyle(.white)
                        }
                        figure(
                            tally.learned,
                            gain: tally.learnedGain,
                            gainTint: DesignTokens.Colors.learned,
                            caption: L10n.homeLearnedCaption
                        ) {
                            Image(systemName: "checkmark.seal.fill")
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, DesignTokens.Colors.learned)
                        }
                        figure(tally.toReview, gain: 0, gainTint: .clear, caption: L10n.studyResultToReview) {
                            Image(systemName: "arrow.clockwise").foregroundStyle(.white)
                        }
                    }
                }

                VStack(spacing: DesignTokens.Spacing.small) {
                    if let onMore, let next = tally?.nextPortion, next > 0 {
                        Button(L10n.studyResultMore(next), action: onMore)
                            .buttonStyle(PrimaryActionStyle())
                            .accessibilityIdentifier(AccessibilityIdentifier.studyResultMore)
                        Button(doneLabel, action: onDone)
                            .buttonStyle(GlassActionStyle())
                            .accessibilityIdentifier(AccessibilityIdentifier.studyResultDone)
                    } else {
                        // The day's allowance is spent: the one way on is out.
                        Button(doneLabel, action: onDone)
                            .buttonStyle(PrimaryActionStyle())
                            .accessibilityIdentifier(AccessibilityIdentifier.studyResultDone)
                    }
                }
            }
        }
    }

    /// The congratulation is earned, not printed: a full house leaves on
    /// "Отлично!", anything else on a plain "Готово".
    private var doneLabel: String {
        summary.rememberedCards == summary.plannedCards
            ? L10n.studyResultExcellent
            : L10n.studyResultDone
    }

    private func figure<Symbol: View>(
        _ value: Int,
        gain: Int,
        gainTint: Color,
        caption: String,
        @ViewBuilder symbol: () -> Symbol
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.extraSmall) {
                symbol()
                    .font(DesignTokens.Typography.sectionTitle)
                    .accessibilityHidden(true)
                Text("\(value)")
                    .font(DesignTokens.Typography.heroNumber)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .foregroundStyle(.white)
                if gain > 0 {
                    Text("+\(gain)")
                        .font(DesignTokens.Typography.caption.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(gainTint)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            Text(caption)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.white.opacity(0.65))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// One flag of the result: the flag on its card plane, and the seal at the
/// top leading corner when it was remembered.
private struct ResultCard: View {
    let card: StudySessionSummary.AnsweredCard
    let size: CGSize
    let store: ContentStore
    let assets: any AssetLoading

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: DesignTokens.Radius.small, style: .continuous)
        FlagImageView(
            assetID: card.promptAssetID,
            accessibilityLabel: card.displayName,
            store: store,
            assets: assets
        )
        .frame(width: size.width, height: size.height)
        .background(DesignTokens.Colors.flatSurface)
        .clipShape(shape)
        .overlay {
            shape.strokeBorder(.white.opacity(DesignTokens.Card.borderOpacity), lineWidth: 1 / displayScale)
        }
        .shadow(color: .black.opacity(0.45), radius: 10, y: 6)
        .overlay(alignment: .topLeading) {
            if card.rating == .good {
                // Over the corner rather than inside it, so the next card in
                // the row, laid over this one's right side, never hides it.
                let seal = size.width * ResultHeapLayout.sealShare
                Image(systemName: "checkmark.seal.fill")
                    .resizable()
                    .scaledToFit()
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, DesignTokens.Colors.learned)
                    .frame(width: seal, height: seal)
                    .shadow(color: DesignTokens.Colors.learned.opacity(0.6), radius: 6)
                    .offset(x: -seal * 0.3, y: -seal * 0.3)
            }
        }
    }
}

/// Where each flag of the result lies (#519), by the rules on the Figma rules
/// board (node 63:85).
///
/// Rows of three, four or five by the size of the sitting, split evenly; in a
/// row the cards overlap to the right by at most half a card; rows step by
/// 0.74 of a card's height; each row lies on a shallow arch and tilts with
/// it; and each card is nudged a little, by the same amount every time for
/// the same country, so the heap looks thrown rather than stacked and never
/// reshuffles.
enum ResultHeapLayout {
    struct Place {
        let center: CGPoint
        let size: CGSize
        let rotation: Double
    }

    struct Plan {
        let places: [Place]
        let height: CGFloat
    }

    /// The seal's size as a share of the card's width.
    static let sealShare: CGFloat = 0.23

    static func plan(seeds: [UInt64], width: CGFloat) -> Plan {
        let count = seeds.count
        guard count > 0, width > 0 else { return Plan(places: [], height: 0) }
        let (perRow, cardWidth): (Int, CGFloat) = count <= 6 ? (3, 156) : count <= 12 ? (4, 140) : (5, 124)
        // The measures are the design's, drawn for a 370-point heap; a
        // narrower screen scales them down rather than clipping the rows.
        let scale = min(1, width / designWidth)
        let w = cardWidth * scale
        let h = w / DesignTokens.Card.aspectRatio
        let rows = Int((Double(count) / Double(perRow)).rounded(.up))
        var sizes = Array(repeating: count / rows, count: rows)
        for row in 0..<(count % rows) { sizes[row] += 1 }
        let damp: CGFloat = count > 12 ? 0.75 : 1
        let margin = DesignTokens.Spacing.medium
        let top = sealShare * w

        var places: [Place] = []
        var bottom: CGFloat = 0
        var index = 0
        for (row, inRow) in sizes.enumerated() {
            let usable = width - 2 * margin - w
            let step = inRow > 1 ? min(w / 2, usable / CGFloat(inRow - 1)) : 0
            let rowWidth = w + step * CGFloat(inRow - 1)
            let shift: CGFloat = (row.isMultiple(of: 2) ? -10 : 10) * scale
            let firstX = (width - rowWidth) / 2 + w / 2 + shift
            let rowY = top + h / 2 + CGFloat(row) * h * 0.74
            for column in 0..<inRow {
                var random = SeededRandom(seed: seeds[index])
                let baseX = firstX + step * CGFloat(column)
                let dx = baseX - width / 2
                let x = min(max(baseX + random.next(8) * damp, margin + w / 2), width - margin - w / 2)
                let y = rowY + 0.0015 * dx * dx + random.next(6) * damp
                let rotation = atan(0.003 * Double(dx)) * 180 / .pi + Double(random.next(7) * damp)
                places.append(Place(center: CGPoint(x: x, y: y), size: CGSize(width: w, height: h), rotation: rotation))
                bottom = max(bottom, y + h / 2)
                index += 1
            }
        }
        return Plan(places: places, height: bottom + DesignTokens.Spacing.large)
    }

    /// A stable number for a flag: FNV-1a over its asset's bytes. `hashValue`
    /// is seeded per launch, and the heap must lie the same way every time.
    static func seed(for id: UUID) -> UInt64 {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        withUnsafeBytes(of: id.uuid) { bytes in
            for byte in bytes {
                hash ^= UInt64(byte)
                hash = hash &* 0x0000_0100_0000_01b3
            }
        }
        return hash
    }

    private static let designWidth: CGFloat = 370
}

/// A small deterministic generator for the heap's nudges (SplitMix64).
private struct SeededRandom {
    var state: UInt64

    init(seed: UInt64) {
        state = seed
    }

    /// A value in -range...range.
    mutating func next(_ range: CGFloat) -> CGFloat {
        state = state &+ 0x9e37_79b9_7f4a_7c15
        var z = state
        z = (z ^ (z >> 30)) &* 0xbf58_476d_1ce4_e5b9
        z = (z ^ (z >> 27)) &* 0x94d0_49bb_1331_11eb
        z ^= z >> 31
        let unit = CGFloat(Double(z >> 11) / Double(1 << 53))
        return (unit * 2 - 1) * range
    }
}
