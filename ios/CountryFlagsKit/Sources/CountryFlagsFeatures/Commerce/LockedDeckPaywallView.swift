import SwiftUI

import CountryFlagsDomain

/// A deck somebody has not bought, as the screen that says what buying it
/// means.
///
/// It is the deck screen with the card list taken out and one explanation put
/// in. The order is `DESIGN.md`'s: the public preview, the deck's own name and
/// size, its description, whatever state needs explaining, the purchase
/// explanation, and the action at the bottom of the screen where every other
/// action in the app already is.
///
/// There is no middle panel — no learning path, no sample card, no story
/// spotlight. Four were built and rejected in design review; they are kept in
/// the appendix of `DESIGN.md` as A/B material and must not be implemented
/// from here.
struct LockedDeckPaywallView: View {
    let deck: DeckRecord
    let store: ContentStore
    let assets: any AssetLoading
    let commerce: CommerceCenter
    /// The unfinished session in this deck, when there is one. A refund does
    /// not take a sitting away halfway through: §11.4 says an open session may
    /// be finished, and this is where the way back to it lives.
    let continuable: ContinuableSession?
    /// Whether this account has studied the deck. It is what tells a refund
    /// from a deck nobody ever owned, without storing a second fact about it.
    let hasProgress: Bool
    let onSignIn: () -> Void
    let onContinue: (ContinuableSession) -> Void

    @State private var previewCards: [LearningCardRecord] = []
    @State private var isRestoring = false

    var body: some View {
        SceneScrollView {
            VStack(spacing: DesignTokens.Spacing.large) {
                PaidDeckPreviewFan(
                    cards: previewCards,
                    store: store,
                    assets: assets,
                    missing: missingSymbol
                )

                VStack(spacing: DesignTokens.Spacing.small) {
                    Text(deck.name)
                        .font(DesignTokens.Typography.screenTitle)
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)

                    Text(summary)
                        .font(DesignTokens.Typography.body)
                        .foregroundStyle(.white.opacity(0.55))
                        .accessibilityIdentifier(AccessibilityIdentifier.deckCardCount)

                    if !deck.deckDescription.isEmpty {
                        Text(deck.deckDescription)
                            .font(DesignTokens.Typography.body)
                            .foregroundStyle(.white.opacity(0.7))
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, DesignTokens.Spacing.extraSmall)
                    }
                }
                .frame(maxWidth: .infinity)
            }

            if let status {
                PurchaseStatusCard(status: status, supportID: supportID)
            }

            if let restored = restoreResultLine {
                Text(restored)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.6))
                    .frame(maxWidth: .infinity, alignment: .center)
            }

            PurchaseExplanationCard(price: price) {
                Task { await restore() }
            }

            if let continuable {
                // A refund blocks the next session, not the one already open.
                Button(L10n.commerceFinishSession) { onContinue(continuable) }
                    .buttonStyle(GlassActionStyle())
                    .accessibilityIdentifier(AccessibilityIdentifier.deckResume)
            }
        }
        .accessibilityIdentifier(AccessibilityIdentifier.deckPaywall)
        .navigationTitle(deck.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                DeckAccessBadge(state: isPending ? .pending : .locked)
            }
        }
        .safeAreaInset(edge: .bottom) { purchaseAction }
        .task(id: deck.id) { await loadPreview() }
    }

    // MARK: - The action

    /// One prominent action, or none.
    ///
    /// None is a real state: with the store unable to sell this deck, a button
    /// that says "buy" and answers with an error is worse than a card that
    /// says why and a restore that might still work.
    @ViewBuilder
    private var purchaseAction: some View {
        if let label = actionLabel {
            Button {
                Task { await act() }
            } label: {
                HStack(spacing: DesignTokens.Spacing.small) {
                    if isWorking {
                        ProgressView().tint(.black)
                    }
                    Text(label)
                }
            }
            .buttonStyle(PrimaryActionStyle())
            .disabled(!isActionEnabled)
            .accessibilityIdentifier(AccessibilityIdentifier.deckBuy)
            .padding(.horizontal, DesignTokens.Spacing.medium)
            .padding(.bottom, DesignTokens.Spacing.medium)
        }
    }

    private var actionLabel: String? {
        if commerce.isGuest { return L10n.commerceSignInToBuy }
        switch commerce.phase(of: deck) {
        case .awaitingApproval: return L10n.commerceAwaitingConfirmation
        case .delivering: return L10n.commerceOpeningDeck
        case .purchasing, .idle, .failed:
            switch price {
            case .priced(let displayPrice): return L10n.commerceBuy(displayPrice)
            case .loading: return nil
            case .unavailable: return nil
            }
        }
    }

    private var isWorking: Bool {
        switch commerce.phase(of: deck) {
        case .purchasing, .delivering: true
        case .idle, .awaitingApproval, .failed: false
        }
    }

    /// A pending purchase disables the action rather than hiding it: the words
    /// are the explanation, and a second tap must not start a second purchase.
    private var isActionEnabled: Bool {
        if commerce.isGuest { return true }
        switch commerce.phase(of: deck) {
        case .idle, .failed: return true
        case .purchasing, .delivering, .awaitingApproval: return false
        }
    }

    private func act() async {
        guard !commerce.isGuest else {
            onSignIn()
            return
        }
        await commerce.purchase(deck)
    }

    private func restore() async {
        guard !isRestoring else { return }
        isRestoring = true
        _ = await commerce.restorePurchases()
        isRestoring = false
    }

    // MARK: - What the screen says

    private var price: StorePriceState { commerce.price(of: deck) }

    private var isPending: Bool {
        if case .awaitingApproval = commerce.phase(of: deck) { return true }
        return false
    }

    /// The one card, when there is something to explain.
    ///
    /// The order matters: what the person is waiting on comes before what went
    /// wrong last time, and a cancellation is nowhere in it.
    private var status: CommerceStatus? {
        switch commerce.phase(of: deck) {
        case .awaitingApproval:
            return .pending
        case .failed(let failure):
            switch failure.reason {
            case .couldNotVerify: return .unverified
            case .productUnavailable: return .unavailable
            case .purchasesNotAllowed: return .notAllowed
            case .network: return .network
            case .store: return .store
            case .backendUnreachable: return .syncing
            // A guest is not an error; the action says "sign in".
            case .accountRequired: return nil
            }
        case .idle, .purchasing, .delivering:
            break
        }
        if hasProgress {
            // Studied, and now locked. The only way into that is a purchase
            // taken back — so the card says the access ended and that the
            // progress is kept, rather than pretending nothing happened.
            return .revoked
        }
        return commerce.isPurchaseAvailable ? nil : .unavailable
    }

    private var supportID: String? {
        guard case .failed(let failure) = commerce.phase(of: deck) else { return nil }
        return failure.supportID
    }

    private var restoreResultLine: String? {
        guard case .restored(let keys, let found)? = commerce.lastRestore else { return nil }
        // Finding nothing is a result rather than an error, and it is the one
        // a person who bought on another Apple Account needs to read.
        return found == 0 || keys.isEmpty ? L10n.commerceRestoredNothing : L10n.commerceRestored
    }

    /// "52 cards · coats of arms", from what the release published rather than
    /// from the deck's name.
    private var summary: String {
        let count = L10n.deckCardCount(deck.cardCount)
        let kinds = deck.contentKinds.compactMap(L10n.contentKind)
        guard !kinds.isEmpty else { return count }
        return "\(count) · \(kinds.joined(separator: ", "))"
    }

    private var missingSymbol: MissingAssetSymbol {
        deck.contentKinds.contains(AssetType.coatOfArms.rawValue) ? .coatOfArms : .flag
    }

    private func loadPreview() async {
        var loaded: [LearningCardRecord] = []
        for id in deck.previewCardIDs {
            if let card = await store.card(id: id) { loaded.append(card) }
        }
        previewCards = loaded
    }
}
