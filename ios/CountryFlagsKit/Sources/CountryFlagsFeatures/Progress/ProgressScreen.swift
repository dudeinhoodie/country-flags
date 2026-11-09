import SwiftUI

import CountryFlagsDomain

/// What the learner has done so far.
///
/// The counts are the device's own: a guest studies durably and is never
/// synchronised, so a screen that waited for a server would be empty for every
/// user this build has. Mastery is the server's to award and is shown only
/// when it has been.
public struct ProgressScreen: View {
    // The screen owns the store it reads through, like every other screen with
    // one. A destination builds its store as it is presented, and the parent
    // re-renders while a launch is still importing content and synchronising —
    // held in a plain property, each of those would hand the screen a second
    // store that has read nothing yet, and the reading would start over for as
    // long as the launch stayed busy.
    /// The app's one progress store, observed. This screen used to be handed
    /// a freshly built one and load it itself, which is how it could show a
    /// different number than the home screen for the same deck.
    private let store: ProgressStore
    private let onOpenDeck: ((UUID) -> Void)?
    /// Whose phone this is, for the one row that is about the person rather
    /// than the numbers. The shell's own store, observed, so a sign-in made
    /// on the account screen takes the row away without a relaunch.
    private let account: AccountStore?
    /// Opens the sign-in screen.
    private let onSignIn: (() -> Void)?
    /// Opens the catalogue: the way out of an empty screen.
    private let onOpenCatalog: (() -> Void)?

    public init(
        store: ProgressStore,
        onOpenDeck: ((UUID) -> Void)? = nil,
        account: AccountStore? = nil,
        onSignIn: (() -> Void)? = nil,
        onOpenCatalog: (() -> Void)? = nil
    ) {
        self.store = store
        self.onOpenDeck = onOpenDeck
        self.account = account
        self.onSignIn = onSignIn
        self.onOpenCatalog = onOpenCatalog
    }

    public var body: some View {
        content
            .navigationTitle(L10n.progressTitle)
    }

    @ViewBuilder
    private var content: some View {
        if !store.isLoaded {
            ContentLoadingStateView()
        } else if store.hasNoProgress {
            empty
        } else {
            loaded
        }
    }

    /// Nothing studied yet: the world the learner is about to fill, drawn
    /// dark, and the way to start filling it.
    ///
    /// It used to be a chart symbol over two lines of text — a symbol that at
    /// this size read as "o00" — with the sign-in row above it, offering to
    /// keep a progress that did not exist yet. The map is the loaded screen's
    /// own hero, so the first answer lights the picture that was already here
    /// rather than replacing one screen with another.
    private var empty: some View {
        SceneScrollView {
            strandedNotice
                .devBlockID("progress.stranded")

            GlassCard(padding: DesignTokens.Spacing.large) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
                    WorldMapView(brightness: [:])
                        .frame(maxWidth: .infinity)

                    VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                        Text(L10n.progressEmptyTitle)
                            .font(DesignTokens.Typography.sectionTitle)
                            .foregroundStyle(.white)
                            .accessibilityIdentifier(AccessibilityIdentifier.progressEmpty)

                        Text(L10n.progressEmptyBody)
                            .font(DesignTokens.Typography.body)
                            .foregroundStyle(.white.opacity(0.65))
                    }

                    if let onOpenCatalog {
                        Button(L10n.homeOpenCatalog, action: onOpenCatalog)
                            .buttonStyle(GlassActionStyle())
                            .accessibilityIdentifier(
                                AccessibilityIdentifier.progressEmptyOpenCatalog
                            )
                    }
                }
            }
            .devBlockID("progress.empty")
        }
    }

    /// A guest, told on the screen about their progress that it lives on this
    /// phone alone.
    ///
    /// The home screen's row, but without the home screen's threshold: there
    /// the offer waits until the work is worth a word, because the screen is
    /// about today; here the person has opened the tab that is about what
    /// they have kept, and that it is kept nowhere else is the first thing to
    /// know about it — once there is something to count. On the empty screen
    /// it offered to keep a progress that did not exist, so it waits for the
    /// first answer. The caption carries the number once there is one. It
    /// cannot be dismissed and goes away when they sign in.
    /// A sign-in that expired is the home screen's to announce: its caption
    /// counts answers waiting to upload, which this screen does not read.
    @ViewBuilder
    private var accountPrompt: some View {
        if let onSignIn, case .guest? = account?.resolvedState {
            AccountPromptRow(
                symbol: "person.crop.circle",
                title: L10n.homeGuestPromptTitle,
                caption: learnedCards > 0
                    ? L10n.homeGuestPromptCount(learnedCards)
                    : L10n.accountGuestNote,
                identifier: AccessibilityIdentifier.progressGuestPrompt,
                action: onSignIn
            )
        }
    }

    /// What a catalogue change could not carry across, said out loud.
    ///
    /// The seeded catalogue this build ships is superseded whole by the first
    /// release a server hands over, and the work done on it is moved onto the
    /// arriving identifiers card by card (ADR-021). A card the arriving
    /// release no longer publishes has nowhere to move to. Its rows are still
    /// on the device — nothing is deleted — but they can never be counted
    /// again, and #404 is precisely about that happening without a word: the
    /// owner studied, signed in, and the numbers were gone.
    ///
    /// Dismissible, and said once: it describes something that has already
    /// finished happening.
    @ViewBuilder
    private var strandedNotice: some View {
        if let notice = store.strandedNotice {
            GlassCard(padding: DesignTokens.Spacing.medium) {
                HStack(alignment: .top, spacing: DesignTokens.Spacing.small) {
                    Image(systemName: "exclamationmark.circle")
                        .symbolRenderingMode(.hierarchical)
                        .foregroundStyle(.white.opacity(0.75))

                    VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                        Text(L10n.progressStrandedTitle)
                            .font(DesignTokens.Typography.sectionTitle)
                            .foregroundStyle(.white)
                        Text(L10n.progressStrandedBody(notice.cardCount))
                            .font(DesignTokens.Typography.body)
                            .foregroundStyle(.white.opacity(0.65))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier(AccessibilityIdentifier.progressStrandedNotice)

                    Button {
                        store.dismissStrandedNotice()
                    } label: {
                        Image(systemName: "xmark")
                            .font(DesignTokens.Typography.caption)
                            .foregroundStyle(.white.opacity(0.6))
                            // A glyph is not a target. The hit area is the
                            // one every other control on this screen has.
                            .frame(
                                width: DesignTokens.Layout.minimumTouchTarget,
                                height: DesignTokens.Layout.minimumTouchTarget
                            )
                            .contentShape(.rect)
                    }
                    .accessibilityLabel(L10n.progressStrandedDismiss)
                    .accessibilityIdentifier(AccessibilityIdentifier.progressStrandedDismiss)
                }
            }
        }
    }

    private var loaded: some View {
        SceneScrollView {
            strandedNotice
                .devBlockID("progress.stranded")
            accountPrompt
                .devBlockID("progress.account")

            // The hero is the world itself: every continent drawn from the
            // app's own geodata, its brightness the share of it known (#528):
            // lit by learned alone it stayed dark for the whole first day,
            // while known moves with every new card. The
            // rows underneath answer "where exactly"; this answers "how much
            // of the world", which is the question the screen is opened with.
            GlassCard(padding: DesignTokens.Spacing.large) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
                    WorldMapView(
                        brightness: Dictionary(
                            otherDecks.map { ($0.code, $0.fraction) },
                            uniquingKeysWith: { first, _ in first }
                        )
                    )
                    .frame(maxWidth: .infinity)

                    // Known beside learned, the pair Home leads with (#497):
                    // learned alone read zero for the whole first day, while
                    // known moves with every new card. Learned keeps its
                    // place out of the deck — this is the screen that answers
                    // "how much of the world" — and known stands before it as
                    // the part already met.
                    HStack(alignment: .top, spacing: DesignTokens.Spacing.extraLarge) {
                        VStack(alignment: .leading, spacing: 2) {
                            SectionLabel(L10n.progressKnownLabel)
                            Text("\(knownCards)")
                                .font(DesignTokens.Typography.heroNumber)
                                .monospacedDigit()
                                .contentTransition(.numericText())
                        }
                        .foregroundStyle(.white)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier(AccessibilityIdentifier.progressKnownCounts)

                        VStack(alignment: .leading, spacing: 2) {
                            SectionLabel(L10n.progressLearnedLabel)
                            HStack(
                                alignment: .firstTextBaseline,
                                spacing: DesignTokens.Spacing.extraSmall
                            ) {
                                Text("\(learnedCards)")
                                    .font(DesignTokens.Typography.heroNumber)
                                    .monospacedDigit()
                                    .contentTransition(.numericText())
                                Text("/ \(totalCards)")
                                    .font(DesignTokens.Typography.sectionTitle)
                                    .foregroundStyle(.white.opacity(0.55))
                            }
                        }
                        .foregroundStyle(.white)
                        .accessibilityElement(children: .combine)
                        // The whole-picture counts keep the identifier the
                        // curated row used to carry: same fact, new place. It
                        // is applied after the combine — on a container it
                        // would be stamped onto every text inside, and a query
                        // that asks for the single element would find a crowd.
                        .accessibilityIdentifier(
                            AccessibilityIdentifier.progressDeckCounts(
                                store.whole?.code ?? ALL_COUNTRIES_DECK_CODE
                            )
                        )

                        Spacer(minLength: 0)
                    }

                    // Its own line now: beside two figures it no longer fits
                    // on theirs, and it explains the map above, not the counts.
                    // Contrast raised to the small-text floor and the words
                    // saying what lights up (#528).
                    Text(L10n.progressMapHint)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
            .devBlockID("progress.map")

            if !otherDecks.isEmpty {
                VStack(spacing: DesignTokens.Spacing.tileGap) {
                    // The word Home uses for the same five regions (#557).
                    SectionLabel(L10n.homeRegionsProgressLabel)
                    GlassCard(padding: DesignTokens.Spacing.small) {
                        VStack(spacing: 0) {
                            ForEach(Array(otherDecks.enumerated()), id: \.element.id) { index, deck in
                                if index > 0 {
                                    Divider()
                                        .overlay(.white.opacity(DesignTokens.Card.borderOpacity))
                                }
                                // A row is a door: the drill-down says which countries
                                // stand where.
                                Button {
                                    onOpenDeck?(deck.id)
                                } label: {
                                    regionRow(deck)
                                        .contentShape(.rect)
                                }
                                .buttonStyle(.plain)
                                .disabled(onOpenDeck == nil)
                                .accessibilityElement(children: .combine)
                                .accessibilityIdentifier(
                                    AccessibilityIdentifier.progressDeckRow(deck.code)
                                )
                            }
                        }
                    }
                }
                .devBlockID("progress.regions")
            }
        }
    }

    /// One region as the catalogue's row reads it (#528): the continent lit
    /// by the share known, the name, and the two-layer bar — known in grey,
    /// learned in white over it — that the catalogue and the deck screens
    /// draw too.
    private func regionRow(_ deck: DeckProgressRow) -> some View {
        HStack(spacing: DesignTokens.Spacing.small) {
            ContinentSilhouetteView(
                code: deck.code,
                opacity: 0.15 + 0.85 * deck.fraction
            )
            .frame(width: 44, height: 32)

            VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                Text(deck.name)
                    .font(DesignTokens.Typography.sectionTitle)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                ProgressTrackView(started: deck.fraction, learned: deck.learnedFraction)
            }

            Spacer(minLength: DesignTokens.Spacing.small)

            // The tier chip left this row: beside the name and the counts it
            // broke the line at ordinary widths.
            Text(verbatim: "\(deck.learnedCards)/\(deck.totalCards)")
                .font(DesignTokens.Typography.sectionTitle)
                .monospacedDigit()
                .foregroundStyle(.white.opacity(0.7))
                .accessibilityIdentifier(AccessibilityIdentifier.progressDeckCounts(deck.code))

            if onOpenDeck != nil {
                Image(systemName: "chevron.right")
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.4))
            }
        }
        .padding(.horizontal, DesignTokens.Spacing.small)
        // The rows were as low as a touch target allows, and five of them
        // under the map read as one block of text (#557).
        .frame(minHeight: Self.regionRowHeight)
    }

    private static let regionRowHeight: CGFloat = 68

    /// Every deck except the one the hero already states.
    ///
    /// Not "the ones that are not curated": a release may publish several
    /// curated decks — special areas, and whatever the editors add — and
    /// those used to fall through the screen entirely, excluded from the
    /// rows for being curated and not shown by the hero, which names one
    /// deck. New decks appeared in the catalogue and this tab did not admit
    /// they existed.
    private var otherDecks: [DeckProgressRow] {
        store.decks.filter { $0.id != store.whole?.id }
    }

    /// The hero's numbers: the whole-world deck's, when the release has one.
    /// Which deck that is, the store decides once for every screen.
    private var learnedCards: Int {
        store.whole?.learnedCards ?? otherDecks.reduce(0) { $0 + $1.learnedCards }
    }

    private var totalCards: Int {
        store.whole?.totalCards ?? otherDecks.reduce(0) { $0 + $1.totalCards }
    }

    /// Countries met at all, learned ones included: the same figure as Home's
    /// "known" (#497), from the same deck with the same fallback, so the two
    /// screens never disagree about it.
    private var knownCards: Int {
        store.whole?.startedCards ?? otherDecks.reduce(0) { $0 + $1.startedCards }
    }
}

/// The world, assembled from the same silhouettes everything else draws.
///
/// The layout is a hand-set composition rather than a projection: each
/// continent sits at a fixed fraction of the pane, sized to read at a
/// glance, and its brightness is the share of it known (#528). Fill the
/// world by meeting it, literally.
struct WorldMapView: View {
    /// Deck code to known fraction, 0...1.
    let brightness: [String: Double]

    /// Each continent's box as a fraction of the pane: where it starts and how
    /// much room it gets.
    ///
    /// Boxes rather than a point and a height, because the previous layout
    /// guessed each shape's width from its height and positioned by centre —
    /// so neighbours crept over one another whenever the guess was off. A box
    /// is checked by looking at it: none of these overlap, and each silhouette
    /// is drawn to fit inside its own.
    private static let placements:
        [(code: String, x: Double, y: Double, width: Double, height: Double)] = [
            ("AMERICAS", 0.03, 0.06, 0.29, 0.86),
            ("EUROPE", 0.33, 0.04, 0.17, 0.32),
            ("AFRICA", 0.35, 0.38, 0.19, 0.56),
            ("ASIA", 0.52, 0.02, 0.33, 0.56),
            ("OCEANIA", 0.75, 0.58, 0.19, 0.32),
        ]

    var body: some View {
        GeometryReader { proxy in
            ForEach(Self.placements, id: \.code) { placement in
                ContinentSilhouetteView(
                    code: placement.code,
                    opacity: 0.15 + 0.85 * (brightness[placement.code] ?? 0)
                )
                .frame(
                    width: proxy.size.width * placement.width,
                    height: proxy.size.height * placement.height
                )
                .position(
                    x: proxy.size.width * (placement.x + placement.width / 2),
                    y: proxy.size.height * (placement.y + placement.height / 2)
                )
            }
        }
        .aspectRatio(1.9, contentMode: .fit)
        .accessibilityHidden(true)
    }
}
