import SwiftUI

import CountryFlagsDomain

/// The deck catalog, as an atlas.
///
/// One column. The curated deck leads with a fan of its own cards; each
/// region under it is recognised by its continent's shape — drawn large and
/// bright, the row's own subject rather than a watermark — with the learner's
/// trail beside it: how many cards, how many learned, and the same two-layer
/// bar the progress screen reads. Sections need no headings when every row
/// says what it is.
public struct CatalogView: View {
    private let store: ContentStore
    private let assets: any AssetLoading
    /// The app's one progress store, observed rather than built here.
    private let progress: ProgressStore?
    /// Commerce, when this build has any. Nil is a catalogue that has never
    /// heard of money: every row is a free row and nothing below changes.
    private let commerce: CommerceCenter?
    private let onOpenDeck: (UUID) -> Void

    @State private var searchText = ""
    /// The three flags each curated deck fans, keyed by deck.
    ///
    /// One fan per deck rather than one for all of them: a release publishes
    /// several curated decks now, and a single shared fan drew the same three
    /// flags on every one of them — every custom deck wearing the
    /// all-countries deck's cards.
    @State private var curatedFans: [UUID: [LearningCardRecord]] = [:]

    public init(
        store: ContentStore,
        assets: any AssetLoading,
        progress: ProgressStore? = nil,
        commerce: CommerceCenter? = nil,
        onOpenDeck: @escaping (UUID) -> Void
    ) {
        self.store = store
        self.assets = assets
        self.progress = progress
        self.commerce = commerce
        self.onOpenDeck = onOpenDeck
    }

    public var body: some View {
        content
            .navigationTitle(L10n.catalogTitle)
            .searchable(text: $searchText, prompt: L10n.catalogSearchPrompt)
            .refreshable { await RefreshGesture.perform { await store.refresh() } }
            .task { await store.start() }
            // The store is asked about the decks that are for sale, once the
            // catalogue exists and never before: a row must be able to scroll
            // past before StoreKit has answered, and a price appears when it
            // does. Keyed to the catalogue so a release that adds a paid deck
            // asks about it without a relaunch.
            .task(id: catalogFingerprint) { await prepareProducts() }
            // On a cold launch the fan races `store.start()`:
            // the catalog is not `.ready` yet, `reloadFan` bails out, and the
            // curated row would keep an empty fan for the whole visit. Keyed
            // to the catalog's content, the fan is re-read the moment the
            // import delivers it — and it is a no-op when the store was warm.
            .task(id: catalogFingerprint) { await reloadFan() }
    }

    /// The ready catalog's identity, for the re-read above; nil while there
    /// is nothing to fan.
    private var catalogFingerprint: Int? {
        guard case .ready(let sections, _, _) = store.catalog else { return nil }
        return sections.hashValue
    }

    @ViewBuilder
    private var content: some View {
        switch store.catalog {
        case .loading:
            ContentLoadingStateView()
        case .empty:
            ContentUnavailableStateView(failure: nil) { await store.refresh() }
        case .failed(let failure):
            ContentUnavailableStateView(failure: failure) { await store.refresh() }
        case .ready(let sections, let isStale, let failure):
            loaded(sections: sections, isStale: isStale, failure: failure)
        }
    }

    private func loaded(
        sections: [CatalogSection],
        isStale: Bool,
        failure: ContentSyncFailure?
    ) -> some View {
        SceneScrollView {
            if isStale || failure != nil {
                ContentStatusBanner(isStale: isStale, failure: failure)
            }

            if let resolution = store.localeResolution, resolution.isFallback {
                Text(L10n.catalogLocaleFallback(resolution.locale))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.6))
                    .accessibilityIdentifier(AccessibilityIdentifier.catalogLocaleFallback)
            }

            let matches = filtered(sections)

            ForEach(Array(matches.enumerated()), id: \.element.id) { index, section in
                // Headings only where there is a shelf to tell apart from the
                // rest. A catalogue of free decks is the one the app has
                // always had, and unchanged content stays visually quiet.
                if let heading = heading(for: section, at: index, in: matches) {
                    SectionLabel(heading)
                }

                ForEach(section.decks, id: \.id) { deck in
                    Button {
                        onOpenDeck(deck.id)
                    } label: {
                        row(
                            deck,
                            isCurated: section.kind == .curated,
                            isLocked: section.isFeatured
                        )
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier(AccessibilityIdentifier.catalogDeckRow(deck.code))
                }
            }

            if matches.isEmpty {
                Text(L10n.catalogNoMatches)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(.white.opacity(0.6))
                    .frame(maxWidth: .infinity, alignment: .center)
                    .accessibilityIdentifier(AccessibilityIdentifier.catalogNoMatches)
            }
        }
    }

    /// One deck, one row. The curated deck carries a fan of its own cards —
    /// it holds every flag, so no single shape stands for it; a region
    /// carries its continent.
    ///
    /// A locked deck is the same row. It gains the badge, the price line and
    /// the action that opens its details — and nothing else: the commerce
    /// metadata stays inside the leading text column so it never competes with
    /// the artwork, and the row is not recoloured.
    private func row(_ deck: DeckRecord, isCurated: Bool, isLocked: Bool) -> some View {
        GlassCard(padding: DesignTokens.Spacing.medium) {
            HStack(spacing: DesignTokens.Spacing.medium) {
                if !isCurated && !isLocked {
                    ContinentSilhouetteView(code: deck.code, opacity: 0.55)
                        .frame(width: 64, height: 48)
                }

                VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                    HStack(alignment: .top, spacing: DesignTokens.Spacing.small) {
                        Text(deck.name)
                            .font(
                                isCurated
                                    ? DesignTokens.Typography.sectionTitle.weight(.bold)
                                    : DesignTokens.Typography.sectionTitle
                            )
                            .foregroundStyle(.white)
                            .lineLimit(1)

                        if isLocked {
                            Spacer(minLength: 0)
                            // Visible before the detail opens: the lock is
                            // what makes the row's destination honest.
                            DeckAccessBadge(state: badgeState(for: deck))
                        }
                    }

                    Text(trail(for: deck))
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.55))

                    if isLocked, let commerce {
                        StorePriceView(state: commerce.price(of: deck))
                    }

                    if let row = progressRow(for: deck) {
                        ProgressTrackView(
                            started: row.fraction, learned: row.learnedFraction
                        )
                    }

                    if isLocked {
                        // It opens the details, which is also what the row
                        // does. It never starts StoreKit: a payment sheet
                        // raised from a list is a payment nobody chose.
                        FeaturedDeckCTA()
                            .padding(.top, DesignTokens.Spacing.small)
                    }
                }

                if isCurated || isLocked {
                    FlagFanView(
                        cards: curatedFans[deck.id] ?? [],
                        store: store,
                        assets: assets
                    )
                }
            }
        }
        // One row is one thing to hear: the name, the trail, nothing twice.
        .accessibilityElement(children: .combine)
        // Combining reads the children in layout order, and the badge sits
        // beside the title because that is where it belongs on screen — so
        // the spoken order came out name, paid, size. `DESIGN.md` asks for
        // deck, card count, paid state, price: stated here rather than
        // rearranged, so the layout stays the approved one.
        .accessibilityLabel(spokenLabel(for: deck, isLocked: isLocked))
    }

    /// What VoiceOver reads for one row, in the order the design settles.
    private func spokenLabel(for deck: DeckRecord, isLocked: Bool) -> String {
        var parts = [deck.name, trail(for: deck)]
        if isLocked {
            parts.append(
                badgeState(for: deck) == .locked
                    ? L10n.commercePaidBadgeAccessibility
                    : L10n.commercePendingBadge
            )
            if let commerce {
                parts.append(StorePriceView(state: commerce.price(of: deck)).spokenText)
            }
        }
        return parts.joined(separator: ", ")
    }

    private func badgeState(for deck: DeckRecord) -> DeckAccessBadge.State {
        if case .awaitingApproval = commerce?.phase(of: deck) { return .pending }
        return .locked
    }

    /// "Featured decks" above the shelf, "Free decks" above what follows it —
    /// and neither when there is no shelf, which is every catalogue this app
    /// has shipped so far.
    private func heading(
        for section: CatalogSection,
        at index: Int,
        in sections: [CatalogSection]
    ) -> String? {
        guard sections.contains(where: \.isFeatured) else { return nil }
        if section.isFeatured {
            return index == 0 ? L10n.catalogFeaturedSection : nil
        }
        let isFirstFree = !sections[..<index].contains { !$0.isFeatured }
        return isFirstFree ? L10n.catalogFreeSection : nil
    }

    /// Asks the store about the decks that are for sale.
    private func prepareProducts() async {
        guard let commerce, case .ready(let sections, _, _) = store.catalog else { return }
        await commerce.prepare(for: sections.flatMap(\.decks))
    }

    /// "250 cards · Learned: 34", and just the count until something is.
    private func trail(for deck: DeckRecord) -> String {
        let count = L10n.deckCardCount(deck.cardCount)
        guard let row = progressRow(for: deck), row.learnedCards > 0 else { return count }
        return "\(count) · \(L10n.progressDeckLearned(row.learnedCards))"
    }

    private func progressRow(for deck: DeckRecord) -> DeckProgressRow? {
        progress?.decks.first { $0.id == deck.id }
    }

    private func reloadFan() async {
        guard case .ready(let sections, _, _) = store.catalog else { return }
        var fans: [UUID: [LearningCardRecord]] = [:]
        for section in sections where section.kind == .curated || section.isFeatured {
            for deck in section.decks {
                if section.isFeatured {
                    // A locked deck holds none of its cards, so its fan is the
                    // handful the release published as a public preview — the
                    // only cards of it this device is allowed to have.
                    var preview: [LearningCardRecord] = []
                    for id in deck.previewCardIDs.prefix(3) {
                        if let card = await store.card(id: id) { preview.append(card) }
                    }
                    fans[deck.id] = preview
                } else {
                    fans[deck.id] = Array(await store.cards(inDeck: deck.id).prefix(3))
                }
            }
        }
        curatedFans = fans
    }

    private func filtered(_ sections: [CatalogSection]) -> [CatalogSection] {
        guard !searchText.isEmpty else { return sections }
        return sections.compactMap { section in
            let decks = CatalogSearch.decks(section.decks, matching: searchText)
            return decks.isEmpty
                ? nil
                : CatalogSection(
                    kind: section.kind,
                    isFeatured: section.isFeatured,
                    decks: decks
                )
        }
    }
}

/// The two-layer trail: the dim reach is what has been touched, the solid
/// one what has actually been learned — the same reading the progress screen
/// gives it.
struct ProgressTrackView: View {
    let started: Double
    let learned: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.15))
                Capsule()
                    .fill(.white.opacity(0.4))
                    .frame(width: fillWidth(started, in: proxy.size.width))
                Capsule()
                    .fill(.white)
                    .frame(width: fillWidth(learned, in: proxy.size.width))
            }
        }
        .frame(height: DesignTokens.Layout.progressBarHeight)
        .accessibilityHidden(true)
    }

    /// Never thinner than the bar is tall: below that a capsule's corner
    /// radius is set by its width and the sliver's ends read square. The
    /// smallest honest fill is a round dot.
    private func fillWidth(_ fraction: Double, in width: CGFloat) -> CGFloat {
        fraction > 0
            ? max(DesignTokens.Layout.progressBarHeight, width * fraction)
            : 0
    }
}
