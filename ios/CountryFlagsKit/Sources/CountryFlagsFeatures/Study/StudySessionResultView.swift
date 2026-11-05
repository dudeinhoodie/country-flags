import SwiftUI

import CountryFlagsDomain

/// The session's result, made of the session's own flags (#519).
///
/// The owner turned down the gauge and its percentage (2026-11-04) and chose,
/// after several rounds, a result that is the sitting itself: every flag
/// answered lies on the screen like a deck slid along a shallow arc, in rows
/// that overlap a little; each remembered flag carries the green seal, and a
/// missed one carries nothing — no red, no grade.
///
/// Under the flags, a panel (#554): three tiles for known, learned and to
/// review, and the way on — the next portion, or done. It takes a third of
/// the screen from edge to edge and has nothing to close it with, because it
/// is part of this screen rather than a sheet over it.
///
/// The figures are the device's count (`StudySessionTally`), as the ring
/// before them was: the panel appears before the sitting's answers can reach
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

    // The arrival (#520): flags fly in one by one, each remembered one gets
    // its seal as it lands, then the panel slides up and its figures count.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// How many flags have been sent on their way.
    @State private var landed = 0
    @State private var sealed: Set<Int> = []
    @State private var isPanelShown = false
    @State private var isFinished = false
    @State private var shownKnown = 0
    @State private var shownLearned = 0

    var body: some View {
        GeometryReader { screen in
            let bottomInset = screen.safeAreaInsets.bottom
            let screenHeight = screen.size.height + screen.safeAreaInsets.top + bottomInset
            VStack(spacing: 0) {
                // The agreed design has no visible title: the flags are the
                // result. The sentence is kept for VoiceOver, as the screen's
                // heading, and for the tests that recognise the screen by it.
                Text(L10n.studyResultTitle)
                    .font(DesignTokens.Typography.caption)
                    .frame(width: 1, height: 1)
                    .opacity(0.001)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier(AccessibilityIdentifier.studyResultTitle)

                heap(screenWidth: screen.size.width)

                panel(minHeight: screenHeight * Self.panelShare, bottomInset: bottomInset)
                    .devBlockID("result.panel")
                    // The panel first: its buttons are the way out, and the
                    // flags above it can scroll when large text leaves them
                    // less room.
                    .layoutPriority(1)
                    // Below the screen until the flags have landed, never
                    // hidden: the buttons are there from the first frame for
                    // VoiceOver and for the tests, and a tap anywhere brings
                    // them up.
                    .offset(y: isPanelShown ? 0 : screenHeight)
            }
            // The panel runs under the home indicator to the screen's edge.
            .ignoresSafeArea(.container, edges: .bottom)
        }
        .contentShape(.rect)
        .onTapGesture {
            if !isFinished { finish() }
        }
        .task { await arrive() }
        .hapticFeedback(.impact(weight: .light, intensity: 0.6), trigger: sealed.count)
    }

    // MARK: - The arrival

    /// The fly-in "по очереди", chosen on 2026-11-04 (#520), with the timings
    /// on the rules board: a new flag every 230 / 170 / 105 ms by the sitting's
    /// size, each flying 540 ms (470 at twenty), the seal popping at 85 % of a
    /// remembered flag's flight, then after 480 ms the panel over 600 ms and
    /// its figures counting up 70 ms a step. Reduce Motion lays everything
    /// down at once.
    private func arrive() async {
        let count = summary.answered.count
        shownKnown = (tally?.known ?? 0) - (tally?.knownGain ?? 0)
        shownLearned = (tally?.learned ?? 0) - (tally?.learnedGain ?? 0)
        guard !reduceMotion else { return finish() }
        let rhythm = Self.rhythm(count)
        for index in 0..<count {
            guard !isFinished, !Task.isCancelled else { return }
            withAnimation(.timingCurve(0.12, 0.7, 0.3, 1, duration: rhythm.flight)) {
                landed = index + 1
            }
            if summary.answered[index].rating == .good {
                Task {
                    try? await Task.sleep(for: .seconds(rhythm.flight * 0.85))
                    guard !isFinished else { return }
                    withAnimation(.spring(duration: 0.3, bounce: 0.5)) { _ = sealed.insert(index) }
                }
            }
            try? await Task.sleep(for: .milliseconds(rhythm.interval))
        }
        try? await Task.sleep(for: .seconds(rhythm.flight) + .milliseconds(480))
        guard !isFinished else { return }
        withAnimation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.6)) { isPanelShown = true }
        try? await Task.sleep(for: .milliseconds(600))
        while !isFinished, shownKnown < tally?.known ?? 0 || shownLearned < tally?.learned ?? 0 {
            try? await Task.sleep(for: .milliseconds(70))
            withAnimation(.snappy) {
                if shownKnown < tally?.known ?? 0 { shownKnown += 1 }
                if shownLearned < tally?.learned ?? 0 { shownLearned += 1 }
            }
        }
        isFinished = true
    }

    /// Everything where it ends: a tap during the arrival, or Reduce Motion.
    private func finish() {
        withAnimation(reduceMotion ? nil : .snappy) {
            landed = summary.answered.count
            sealed = Set(summary.answered.indices.filter { summary.answered[$0].rating == .good })
            isPanelShown = true
            shownKnown = tally?.known ?? 0
            shownLearned = tally?.learned ?? 0
        }
        isFinished = true
    }

    private static func rhythm(_ count: Int) -> (interval: Int, flight: Double) {
        count <= 6 ? (230, 0.54) : count <= 12 ? (170, 0.54) : (105, 0.47)
    }

    /// The panel's height as a share of the screen, before its content has a
    /// say: a small phone gets a panel taller than a third.
    private static let panelShare: CGFloat = 1.0 / 3.0

    // MARK: - The flags

    private func heap(screenWidth: CGFloat) -> some View {
        GeometryReader { geometry in
            let plan = ResultHeapLayout.plan(
                seeds: summary.answered.map { ResultHeapLayout.seed(for: $0.promptAssetID) },
                width: geometry.size.width
            )
            ScrollView(.vertical, showsIndicators: false) {
                ZStack(alignment: .topLeading) {
                    ForEach(Array(summary.answered.enumerated()), id: \.offset) { index, card in
                        heapCard(
                            card,
                            at: plan.places[index],
                            launch: ResultHeapLayout.launch(
                                for: plan.places[index],
                                heapWidth: geometry.size.width,
                                screenWidth: screenWidth
                            ),
                            hasLanded: index < landed,
                            showsSeal: sealed.contains(index),
                            isRaised: raised == index
                        )
                        .zIndex(raised == index ? Double(summary.answered.count) : Double(index))
                        .onTapGesture {
                            guard isFinished else { return finish() }
                            withAnimation(.snappy) { raised = raised == index ? nil : index }
                        }
                    }
                }
                .frame(width: geometry.size.width, height: plan.height, alignment: .topLeading)
                // In the middle of the room the panel leaves, whatever the
                // size of the sitting.
                .frame(minHeight: geometry.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
            // A flag waits beyond the side of the screen and flies in across
            // it; clipped to the heap, it would pop into being at the margin.
            .scrollClipDisabled()
        }
        .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
        .padding(.horizontal, DesignTokens.Spacing.medium)
        // One element for VoiceOver: the flags are pictures of the
        // sentence, which says how many were remembered out of the plan
        // and how many come back.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(rememberedSentence)
        .accessibilityIdentifier(AccessibilityIdentifier.studyResultAnswered)
        .devBlockID("result.heap")
    }

    private func heapCard(
        _ card: StudySessionSummary.AnsweredCard,
        at place: ResultHeapLayout.Place,
        launch: ResultHeapLayout.Place,
        hasLanded: Bool,
        showsSeal: Bool,
        isRaised: Bool
    ) -> some View {
        let pose = hasLanded ? place : launch
        return ResultCard(card: card, size: place.size, showsSeal: showsSeal, store: store, assets: assets)
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
            .scaleEffect(isRaised ? 1.08 : hasLanded ? 1 : ResultHeapLayout.launchScale)
            .rotationEffect(.degrees(isRaised ? 0 : pose.rotation))
            .position(pose.center)
    }

    private var rememberedSentence: String {
        var parts = [L10n.studyResultRemembered(summary.rememberedCards, summary.plannedCards)]
        let returning = summary.answeredCards - summary.rememberedCards
        if returning > 0 {
            parts.append(L10n.studyResultReturning(returning))
        }
        return parts.joined(separator: ", ")
    }

    // MARK: - The panel

    private func panel(minHeight: CGFloat, bottomInset: CGFloat) -> some View {
        VStack(spacing: Self.panelGap) {
            if let tally {
                tiles(tally)
            }
            actions
        }
        .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
        .padding(.horizontal, DesignTokens.Spacing.medium)
        .padding(.top, DesignTokens.Spacing.medium)
        .padding(.bottom, bottomInset + DesignTokens.Spacing.small)
        .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .top)
        .background { ResultPanelGround() }
    }

    private func tiles(_ tally: StudySessionTally) -> some View {
        HStack(alignment: .top, spacing: DesignTokens.Spacing.small) {
            ResultTile(
                value: shownKnown,
                gain: tally.knownGain,
                caption: L10n.homeKnownCaption(tally.known)
            ) {
                ResultMosaic(cards: summary.answered, store: store, assets: assets)
            }
            ResultTile(
                value: shownLearned,
                gain: tally.learnedGain,
                caption: L10n.homeLearnedCaption
            ) {
                ResultTileGround(hasAny: tally.learned > 0, colors: ResultTileColors.learned) {
                    ResultTileMark.seal
                }
            }
            ResultTile(
                value: tally.toReview,
                gain: 0,
                caption: L10n.studyResultToReview
            ) {
                ResultTileGround(hasAny: tally.toReview > 0, colors: ResultTileColors.review) {
                    ResultTileMark.arrows
                }
            }
        }
        // A third of the screen wide, a tile runs out of room for a word at
        // the very largest sizes and breaks it in the middle. They stop
        // growing there; VoiceOver reads the whole figure either way.
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        // The tiles take the height of the tallest one: large text wraps a
        // caption in one tile and not in the next.
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private var actions: some View {
        if let onMore, let next = tally?.nextPortion, next > 0 {
            // One row, the way on taking what the way out leaves. The largest
            // text sizes do not fit it, so they get the two stacked.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: DesignTokens.Spacing.small) {
                    doneButton(style: GlassActionStyle())
                        .frame(width: Self.doneWidth)
                    moreButton(next, action: onMore)
                }
                VStack(spacing: DesignTokens.Spacing.small) {
                    moreButton(next, action: onMore)
                    doneButton(style: GlassActionStyle())
                }
            }
        } else {
            // The day's allowance is spent: the one way on is out.
            doneButton(style: PrimaryActionStyle())
        }
    }

    private func moreButton(_ next: Int, action: @escaping () -> Void) -> some View {
        Button(L10n.studyResultMore(next), action: action)
            .buttonStyle(PrimaryActionStyle())
            .accessibilityIdentifier(AccessibilityIdentifier.studyResultMore)
    }

    private func doneButton(style: some ButtonStyle) -> some View {
        Button(doneLabel, action: onDone)
            .buttonStyle(style)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .accessibilityIdentifier(AccessibilityIdentifier.studyResultDone)
    }

    /// The congratulation is earned, not printed: a full house leaves on
    /// "Отлично!", anything else on a plain "Готово".
    private var doneLabel: String {
        summary.rememberedCards == summary.plannedCards
            ? L10n.studyResultExcellent
            : L10n.studyResultDone
    }

    /// Between the tiles and the buttons.
    private static let panelGap: CGFloat = 20
    /// "Готово" beside the white button.
    private static let doneWidth: CGFloat = 112
}

/// What the panel stands on: the old sheet's dark glass, rounded at the top
/// alone because its other three sides are the screen's.
private struct ResultPanelGround: View {
    var body: some View {
        let shape = UnevenRoundedRectangle(
            topLeadingRadius: Self.radius,
            topTrailingRadius: Self.radius,
            style: .continuous
        )
        shape.fill(.ultraThinMaterial)
            .overlay { shape.fill(.black.opacity(0.75)) }
            .overlay { shape.strokeBorder(.white.opacity(DesignTokens.Card.borderOpacity), lineWidth: 1) }
    }

    private static let radius: CGFloat = 36
}

/// One figure of the result: the number and its word at the bottom, the gain
/// as a pill in the corner, over a ground of the caller's choosing.
private struct ResultTile<Ground: View>: View {
    let value: Int
    let gain: Int
    let caption: String
    @ViewBuilder let ground: Ground

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Self.radius, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: DesignTokens.Spacing.extraLarge)
            Text("\(value)")
                .font(DesignTokens.Typography.heroNumber)
                .monospacedDigit()
                .contentTransition(.numericText())
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Text(caption)
                .font(DesignTokens.Typography.tileCaption)
                .foregroundStyle(.white)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                .minimumScaleFactor(0.7)
                .fixedSize(horizontal: false, vertical: dynamicTypeSize.isAccessibilitySize)
        }
        .padding(.leading, Self.inset)
        .padding(.trailing, DesignTokens.Spacing.small)
        .padding(.bottom, Self.inset)
        .frame(maxWidth: .infinity, minHeight: Self.minimumHeight, maxHeight: .infinity, alignment: .leading)
        .background { ground }
        .overlay(alignment: .topTrailing) {
            if gain > 0 {
                Text(verbatim: "+\(gain)")
                    .font(DesignTokens.Typography.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .padding(.horizontal, 7)
                    .frame(minHeight: 22)
                    .background(.white.opacity(0.15), in: Capsule(style: .continuous))
                    .padding(.top, 12)
                    .padding(.trailing, 9)
            }
        }
        .clipShape(shape)
        .overlay { shape.strokeBorder(.white.opacity(0.15), lineWidth: 1) }
        .accessibilityElement(children: .combine)
    }

    private static var radius: CGFloat { 22 }
    private static var inset: CGFloat { 14 }
    private static var minimumHeight: CGFloat { 156 }
}

/// A tile's colour and its large faint mark. A zero is not celebrated and is
/// not a warning either, so it gets neither colour: quiet glass and a fainter
/// mark.
private struct ResultTileGround<Mark: View>: View {
    let hasAny: Bool
    let colors: [Color]
    @ViewBuilder let mark: Mark

    var body: some View {
        ZStack(alignment: .topLeading) {
            if hasAny {
                LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
            } else {
                Color.white.opacity(0.08)
            }
            mark
                .opacity(hasAny ? 0.16 : 0.06)
                .accessibilityHidden(true)
        }
    }
}

/// The colours of the two tiles that have one.
private enum ResultTileColors {
    static let learned = [
        Color(.sRGB, red: 64 / 255, green: 219 / 255, blue: 107 / 255),
        Color(.sRGB, red: 13 / 255, green: 143 / 255, blue: 51 / 255),
    ]
    static let review = [
        Color(.sRGB, red: 255 / 255, green: 168 / 255, blue: 31 / 255),
        Color(.sRGB, red: 168 / 255, green: 92 / 255, blue: 0),
    ]
}

/// The tiles' large marks, placed from the tile's top leading corner and cut
/// off by its edge.
private enum ResultTileMark {
    static var seal: some View {
        Image(systemName: "checkmark.seal.fill")
            .resizable()
            .scaledToFit()
            .foregroundStyle(.white)
            .frame(width: 109, height: 109)
            .offset(x: 40, y: 40)
    }

    static var arrows: some View {
        Image(systemName: "arrow.triangle.2.circlepath")
            .resizable()
            .scaledToFit()
            .fontWeight(.bold)
            .foregroundStyle(.white)
            .frame(width: 68, height: 68)
            .offset(x: 57, y: 61)
    }
}

/// The known tile's ground: the sitting's last four answers, blurred until
/// they are colour rather than flags, so the tile is a picture of what was
/// just done and never of some other flags.
private struct ResultMosaic: View {
    let cards: [StudySessionSummary.AnsweredCard]
    let store: ContentStore
    let assets: any AssetLoading

    var body: some View {
        ZStack {
            DesignTokens.Colors.flatSurface
            ZStack {
                ForEach(Array(filled.enumerated()), id: \.offset) { index, card in
                    let slot = Self.slots[index]
                    FlagImageView(
                        assetID: card.promptAssetID,
                        accessibilityLabel: card.displayName,
                        store: store,
                        assets: assets,
                        contentMode: .fill
                    )
                    .frame(width: 127, height: 95)
                    .clipped()
                    .rotationEffect(.degrees(slot.rotation))
                    .offset(x: slot.x, y: slot.y)
                }
            }
            .blur(radius: 7)
            // Dark enough for the white pill at the top and the figure below
            // it over any flag, a white one included.
            LinearGradient(
                stops: [
                    .init(color: .black.opacity(0.32), location: 0),
                    .init(color: .black.opacity(0.42), location: 0.5),
                    .init(color: .black.opacity(0.75), location: 1),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .accessibilityHidden(true)
    }

    /// Four whatever the sitting's size: a sitting of one card is one flag
    /// four times, not three holes.
    private var filled: [StudySessionSummary.AnsweredCard] {
        let last = Array(cards.suffix(Self.slots.count))
        guard !last.isEmpty else { return [] }
        return Self.slots.indices.map { last[$0 % last.count] }
    }

    /// Where the flags lie, from the tile's centre, and how they are turned.
    private static let slots: [(x: CGFloat, y: CGFloat, rotation: Double)] = [
        (-51, -28, 10),
        (52, -52, -8),
        (-33, 38, -6),
        (36, 58, 12),
    ]
}

/// One flag of the result: the flag on its card plane, and the seal at the
/// top leading corner when it was remembered.
private struct ResultCard: View {
    let card: StudySessionSummary.AnsweredCard
    let size: CGSize
    /// The seal pops in as the remembered flag lands (#520).
    let showsSeal: Bool
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
            if card.rating == .good, showsSeal {
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
                    .transition(.scale(scale: 0).combined(with: .opacity))
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

    /// How much larger a flag is as it sets off than where it lands.
    static let launchScale: CGFloat = 1.25

    /// Where a flag waits before its flight (#554): wholly beyond the side of
    /// the screen nearer its place, turned 35 degrees and at its larger size.
    ///
    /// It used to wait below the heap, which is not below the screen: until
    /// the panel rose, that spot was empty screen, and every flag sat there in
    /// plain view before it flew.
    ///
    /// - Parameters:
    ///   - heapWidth: the width of the space the places are measured in.
    ///   - screenWidth: the screen's, which the heap is centred in.
    static func launch(for place: Place, heapWidth: CGFloat, screenWidth: CGFloat) -> Place {
        let fromLeft = place.center.x < heapWidth / 2
        let margin = max(0, screenWidth - heapWidth) / 2
        // However it is turned, a card reaches no further from its centre
        // than half its diagonal; its shadow reaches a little further.
        let reach = hypot(place.size.width, place.size.height) / 2 * launchScale + launchShadow
        return Place(
            center: CGPoint(
                x: fromLeft ? -margin - reach : heapWidth + margin + reach,
                y: place.center.y
            ),
            size: place.size,
            rotation: fromLeft ? -35 : 35
        )
    }

    private static let launchShadow: CGFloat = 16

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
