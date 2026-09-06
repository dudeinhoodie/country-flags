import SwiftUI

import CountryFlagsDomain

/// The pieces a paid deck adds to screens that already exist.
///
/// Five of them, and no sixth: `DESIGN.md` settles that paid is an access
/// state rather than a second brand, so the catalogue row, the deck screen and
/// the bottom action stay the ones the app already has and only gain a badge,
/// a price line, one call to action, one explanation and — when there is
/// something to explain — one status card.

// MARK: - The badge

/// A compact capsule that says a deck has to be bought.
///
/// Symbol and word together, never colour alone: the lock is what makes it
/// legible to somebody who cannot tell the capsule's tint from the row's. It
/// is informational and not tappable — the whole row already opens the deck,
/// and a control inside a control is two targets where a person aimed at one.
struct DeckAccessBadge: View {
    enum State {
        case locked
        case pending
    }

    let state: State

    var body: some View {
        HStack(spacing: DesignTokens.Spacing.extraSmall) {
            Image(systemName: state == .locked ? "lock.fill" : "clock")
                .font(.caption2.weight(.semibold))
            Text(state == .locked ? L10n.commercePaidBadge : L10n.commercePendingBadge)
                .font(DesignTokens.Typography.caption.weight(.semibold))
        }
        .foregroundStyle(.white.opacity(0.85))
        .padding(.horizontal, DesignTokens.Spacing.small)
        .padding(.vertical, DesignTokens.Spacing.extraSmall)
        .glassEffect(.regular, in: Capsule(style: .continuous))
        // One word, not two: VoiceOver reads the row as a whole and "lock,
        // paid" would be the same fact twice.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            state == .locked
                ? L10n.commercePaidBadgeAccessibility
                : L10n.commercePendingBadge
        )
        .accessibilityIdentifier(
            state == .locked
                ? AccessibilityIdentifier.deckPaidBadge
                : AccessibilityIdentifier.deckPendingBadge
        )
    }
}

// MARK: - The price

/// What a deck costs, in the only three states there are.
///
/// The loading case reserves the line rather than collapsing it, so the row
/// does not jump when the store answers — and it says "price loading" instead
/// of showing a number, because a placeholder price is a number App Review
/// never approved.
struct StorePriceView: View {
    let state: StorePriceState

    var body: some View {
        Text(text)
            .font(DesignTokens.Typography.caption)
            .foregroundStyle(.white.opacity(state.isPriced ? 0.75 : 0.5))
            // Never truncated. "Purchase temporarily unavailable" is the
            // longest thing this line ever says and the one a person most
            // needs to read whole; it takes a second line rather than an
            // ellipsis.
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier(AccessibilityIdentifier.deckPrice)
    }

    private var text: String {
        switch state {
        case .loading: L10n.commercePriceLoading
        case .priced(let displayPrice): L10n.commerceOneTimePrice(displayPrice)
        case .unavailable: L10n.commercePriceUnavailable
        }
    }

    /// The same words, for a caller that has to place them in a label of its
    /// own — a catalogue row is one accessibility element, so its price is
    /// spoken as part of the row rather than after it.
    var spokenText: String { text }
}

extension StorePriceState {
    var isPriced: Bool {
        if case .priced = self { return true }
        return false
    }

    var displayPrice: String? {
        if case .priced(let price) = self { return price }
        return nil
    }
}

// MARK: - The catalogue's call to action

/// The compact action on a paid catalogue row.
///
/// Candidate C of `DESIGN.md`: a glass capsule with a contained bloom, a white
/// label and a small chevron orb. The bloom is confined to this one control —
/// it does not recolour the row, the badge or the paywall — and there is no
/// outer glow, because the row's own artwork is the thing that should catch
/// the eye.
///
/// It opens the deck. It never starts StoreKit: a payment sheet raised from a
/// list is a payment nobody chose to begin.
struct FeaturedDeckCTA: View {
    var body: some View {
        HStack(spacing: DesignTokens.Spacing.small) {
            Text(L10n.commerceExploreDeck)
                .font(DesignTokens.Typography.caption.weight(.semibold))
                .foregroundStyle(.white)
            Image(systemName: "chevron.right")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.white)
                .padding(DesignTokens.Spacing.extraSmall)
                .background(.white.opacity(0.18), in: Circle())
        }
        .padding(.horizontal, DesignTokens.Spacing.medium)
        .padding(.vertical, DesignTokens.Spacing.small)
        .background {
            Capsule(style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.16, green: 0.24, blue: 0.72),
                            Color(red: 0.31, green: 0.20, blue: 0.66),
                            Color(red: 0.47, green: 0.17, blue: 0.44),
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
        }
        .clipShape(Capsule(style: .continuous))
        .accessibilityHidden(true)
    }
}

// MARK: - The explanation

/// The one glass pane that says what buying this deck means.
///
/// Price, promise and the way back in, and nothing else: no crossed-out price,
/// no percentage, no countdown and no second Buy button. The restore action
/// lives here because somebody who already paid arrives at this screen looking
/// for it, and Account has the other copy.
struct PurchaseExplanationCard: View {
    let price: StorePriceState
    let onRestore: () -> Void

    var body: some View {
        GlassCard(padding: DesignTokens.Spacing.medium) {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
                HStack(alignment: .firstTextBaseline, spacing: DesignTokens.Spacing.medium) {
                    VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                        Text(L10n.commerceOneTimeTitle)
                            .font(DesignTokens.Typography.sectionTitle)
                            .foregroundStyle(.white)
                        Text(L10n.commerceAccessForever)
                            .font(DesignTokens.Typography.caption)
                            .foregroundStyle(.white.opacity(0.6))
                        Text(L10n.commerceBelongsToAccount)
                            .font(DesignTokens.Typography.caption)
                            .foregroundStyle(.white.opacity(0.6))
                    }
                    Spacer(minLength: 0)
                    if let displayPrice = price.displayPrice {
                        Text(displayPrice)
                            .font(DesignTokens.Typography.sectionTitle.weight(.bold))
                            // Only where the layout needs it to hold still.
                            .monospacedDigit()
                            .foregroundStyle(.white)
                            .accessibilityIdentifier(AccessibilityIdentifier.deckPrice)
                    } else {
                        StorePriceView(state: price)
                    }
                }

                Button(L10n.commerceRestore, action: onRestore)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(.white.opacity(0.85))
                    .accessibilityIdentifier(AccessibilityIdentifier.deckRestore)

                Text(L10n.commerceOtherDevice)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.45))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - The status card

/// Everything a purchase can be in the middle of, as one word each.
///
/// Raw values are string-catalog keys, which is what keeps the copy for a
/// state and the state itself from drifting apart.
enum CommerceStatus: String {
    case pending
    case unavailable
    case notAllowed = "not_allowed"
    case network
    case store
    case unverified
    case revoked
    case syncing
    case downloading
    case downloadFailed = "download_failed"

    var symbol: String {
        switch self {
        case .pending: "clock"
        case .unavailable, .notAllowed: "exclamationmark.triangle"
        case .network, .store, .unverified, .downloadFailed: "exclamationmark.triangle"
        case .revoked: "lock.fill"
        case .syncing, .downloading: "arrow.clockwise"
        }
    }
}

/// One card, shown only when a state needs explaining.
///
/// A cancellation is not one of them: somebody who changed their mind has not
/// hit an error, and telling them they have is how a support ticket gets
/// opened about a working app.
struct PurchaseStatusCard: View {
    let status: CommerceStatus
    /// The number a person reads out to support, where there is one.
    var supportID: String?

    var body: some View {
        GlassCard(padding: DesignTokens.Spacing.medium) {
            HStack(alignment: .top, spacing: DesignTokens.Spacing.medium) {
                Image(systemName: status.symbol)
                    .symbolRenderingMode(.hierarchical)
                    .font(.title3)
                    .foregroundStyle(.white.opacity(0.8))
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                    Text(L10n.commerceStatusTitle(status))
                        .font(DesignTokens.Typography.sectionTitle)
                        .foregroundStyle(.white)
                    Text(L10n.commerceStatusBody(status))
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.6))
                        .fixedSize(horizontal: false, vertical: true)
                    if let supportID {
                        Text(L10n.commerceSupportID(supportID))
                            .font(DesignTokens.Typography.caption)
                            .monospaced()
                            .foregroundStyle(.white.opacity(0.45))
                            .textSelection(.enabled)
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AccessibilityIdentifier.deckPurchaseStatus)
    }
}

// MARK: - The preview hero

/// The three cards a locked deck may show, fanned.
///
/// The same grammar as the catalogue's fan, at the size of a hero: the centre
/// card upright and in front, its neighbours leaning away behind it. The order
/// is the release's — the preview identifiers a deck publishes, in the order
/// it publishes them — so the arrangement the design approved is the
/// arrangement the content decides, not one this view invents.
struct PaidDeckPreviewFan: View {
    let cards: [LearningCardRecord]
    let store: ContentStore
    let assets: any AssetLoading
    /// A coat of arms is drawn on a plane and a flag fills its card; the
    /// placeholder has to name the right absent thing.
    var missing: MissingAssetSymbol = .flag

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        ZStack {
            ForEach(Array(ordered.enumerated()), id: \.element.id) { index, card in
                let pose = Self.poses[index]
                FlagImageView(
                    assetID: card.promptAssetID,
                    accessibilityLabel: card.displayName,
                    store: store,
                    assets: assets,
                    missing: missing
                )
                .frame(width: Self.card.width, height: Self.card.height)
                .background(.white.opacity(0.04))
                .clipShape(
                    RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
                        .strokeBorder(
                            .white.opacity(DesignTokens.Card.borderOpacity),
                            lineWidth: 1 / displayScale
                        )
                }
                .shadow(color: .black.opacity(0.4), radius: 18, y: 10)
                .rotationEffect(.degrees(pose.rotation))
                .offset(x: pose.x, y: pose.y)
                .zIndex(pose.depth)
            }
        }
        .frame(height: Self.frameHeight)
        .frame(maxWidth: .infinity)
        // Decoration beside a title that already names the deck. Reading three
        // flags out before the price is three facts nobody asked for.
        .accessibilityHidden(true)
    }

    /// Left, centre, right, in the order the release published them. Three at
    /// most: a fourth card would shrink the other three below the size at
    /// which a flag is still a flag.
    private var ordered: [LearningCardRecord] {
        Array(cards.prefix(3))
    }

    private static let card = CGSize(width: 132, height: 176)
    private static let frameHeight: CGFloat = 232
    /// Left, centre, right — the arrangement the design approved, with the
    /// middle card upright and in front.
    private static let poses: [(rotation: Double, x: CGFloat, y: CGFloat, depth: Double)] = [
        (-8, -112, 16, 0),
        (0, 0, -8, 2),
        (8, 112, 16, 1),
    ]
}
