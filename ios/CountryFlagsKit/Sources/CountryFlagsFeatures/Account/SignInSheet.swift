import SwiftUI

import CountryFlagsDomain

/// What the sign-in screen throws over its promise: the catalogue to read
/// cards from, the assets to draw them with and the progress that says which
/// of them are the learner's.
///
/// A value rather than three parameters threaded through the account screen
/// and its section: the three only ever travel together, and the screen that
/// receives them asks one question of them.
public struct SignInFan {
    let content: ContentStore
    let assets: any AssetLoading
    let progress: ProgressStore

    public init(content: ContentStore, assets: any AssetLoading, progress: ProgressStore) {
        self.content = content
        self.assets = assets
        self.progress = progress
    }

    /// Three of the learner's countries: the ones learned first, because the
    /// promise under the fan is about keeping them, and the rest of the deck
    /// with the most of them after. A guest who has learned nothing yet still
    /// gets a pile — the opening of the same deck — so the screen says the
    /// same thing to everybody, with the flags that are theirs once any are.
    @MainActor
    func cards() async -> [LearningCardRecord] {
        let decks = progress.decks.filter(\.isCurated)
        guard let deck = decks.max(by: { $0.learnedCards < $1.learnedCards }) ?? decks.first
        else { return [] }
        let cards = await content.cards(inDeck: deck.id).filter { !$0.isRetired }
        let states = progress.isLoaded ? await progress.cardStatesByID() : [:]
        let learned = LocalProgressProjection.learnedCardIDs(
            among: Set(cards.map(\.id)),
            states: Array(states.values)
        )
        // Names break the ties on both sides, so the fan holds still between
        // openings instead of reshuffling under the learner.
        let sorted = cards.sorted { left, right in
            let leftLearned = learned.contains(left.id)
            let rightLearned = learned.contains(right.id)
            if leftLearned != rightLearned { return leftLearned }
            return left.displayName < right.displayName
        }
        return Array(sorted.prefix(3))
    }
}

/// The way in, as a screen of its own.
///
/// It is opened from the guest's row on the account screen, and it exists
/// because the buttons did not belong there: two brand capsules in a settings
/// form read as somebody else's controls. Here they close a page that first
/// says what an account is for — the learner's own flags, the promise, three
/// lines of what changes — and they stand on a light tray, which is the
/// ground both brands draw their solid buttons for.
///
/// The tray is the one light surface in the app. It is a solid light grey
/// rather than a material because a Sign in with Apple button is black or
/// white and nothing in between, and black wants a light ground under it;
/// grey rather than white, because white under a dark scene glared. The scene
/// stays above so the screen is still this app's.
///
/// Signing in is the store's business. The sheet only reports and closes: it
/// dismisses itself once the store says somebody is in, and offers a way out
/// that is a plain button, not a gesture — a guest must be able to decline
/// without hunting for the edge of a sheet.
struct SignInSheet: View {
    let store: AccountStore
    /// The learner's own count, for the promise. Nil or zero says the same
    /// thing without a number.
    let learnedCountries: Int?
    let fan: SignInFan?
    let privacyPolicyURL: URL?
    let termsURL: URL?

    @State private var fanCards: [LearningCardRecord] = []
    @Environment(\.dismiss) private var dismiss

    /// Larger than the home fan: the same pile, thrown as a hero. Not
    /// twice, which is what it was: with the tray below, the promise and the
    /// three lines under it, a fan that size pushed the page past the screen
    /// on a 6.1-inch phone and made it scroll for two lines.
    private static let fanScale: CGFloat = 1.6

    var body: some View {
        // The tray is a sibling of the scroll view, not an inset on it: as an
        // inset it sat over the scroll view's edge and a drag that began on
        // it pulled the page like a refresh. Outside, it is the floor the
        // page scrolls above, and it does not move.
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: DesignTokens.Spacing.medium) {
                    header

                    if let fan, !fanCards.isEmpty {
                        FlagFanView(
                            cards: fanCards,
                            store: fan.content,
                            assets: fan.assets,
                            scale: Self.fanScale
                        )
                        .padding(.vertical, DesignTokens.Spacing.small)
                        .devBlockID("signin.fan")
                    }

                    promise
                        .devBlockID("signin.promise")
                    benefits
                        .devBlockID("signin.benefits")
                }
                .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, DesignTokens.Spacing.large)
                .padding(.bottom, DesignTokens.Spacing.medium)
            }
            // The page usually fits the screen whole, and a fitting scroll
            // view still rubber-bands; without this it read as a pull with
            // nothing to refresh. It scrolls only when the text setting makes
            // it taller than the screen.
            .scrollBounceBehavior(.basedOnSize)

            tray
        }
        .presentationDetents([.large])
        // No grabber: the close circle is in the header and the pull works
        // from anywhere, so the pellet would be chrome with no job.
        .presentationDragIndicator(.hidden)
        .presentationBackground { AppScene() }
        .task {
            if let fan { fanCards = await fan.cards() }
        }
        // The store owns the outcome; the sheet leaves when it is in.
        .onChange(of: store.state.isAuthenticated) { _, isAuthenticated in
            if isAuthenticated { dismiss() }
        }
    }

    // MARK: - Above the tray

    private var header: some View {
        HStack {
            Spacer(minLength: 0)

            // The size of the avatar and the gear in the bar behind the
            // sheet: the country sheet's smaller circle read here as a
            // control from a different screen.
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(DesignTokens.Typography.body.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(
                        width: DesignTokens.Layout.minimumTouchTarget,
                        height: DesignTokens.Layout.minimumTouchTarget
                    )
                    .glassEffect(.regular.interactive(), in: Circle())
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L10n.studyClose)
            .devBlockID("signin.close")
        }
        .padding(.top, DesignTokens.Spacing.small)
    }

    private var promise: some View {
        VStack(spacing: DesignTokens.Spacing.small) {
            Text(L10n.accountSignInSheetTitle)
                .font(.title.weight(.bold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier(AccessibilityIdentifier.accountSignInSheet)

            Text(promiseBody)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(.white.opacity(0.7))
                .multilineTextAlignment(.center)
        }
    }

    /// The promise with the learner's number in it when there is one to
    /// put there: "96 countries" is this person's work, "your progress" is
    /// a category.
    private var promiseBody: String {
        if let learnedCountries, learnedCountries > 0 {
            return L10n.accountSignInSheetBodyCount(learnedCountries)
        }
        return L10n.accountSignInSheetBody
    }

    private var benefits: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
            benefit("arrow.triangle.2.circlepath", L10n.accountSignInBenefitSync)
            benefit("iphone", L10n.accountSignInBenefitDevices)
            benefit("key", L10n.accountSignInBenefitPassword)
        }
        .padding(.horizontal, DesignTokens.Spacing.small)
    }

    private func benefit(_ symbol: String, _ text: String) -> some View {
        HStack(spacing: DesignTokens.Spacing.medium) {
            Image(systemName: symbol)
                .font(DesignTokens.Typography.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.85))
                .frame(
                    width: DesignTokens.Layout.minimumTouchTarget * 0.75,
                    height: DesignTokens.Layout.minimumTouchTarget * 0.75
                )
                .background(.white.opacity(0.1), in: Circle())
                .accessibilityHidden(true)

            Text(text)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - The tray

    private var tray: some View {
        VStack(spacing: DesignTokens.Spacing.small + 4) {
            if case .authenticating = store.state {
                HStack(spacing: DesignTokens.Spacing.small) {
                    ProgressView()
                    Text(L10n.accountSigningIn)
                }
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier(AccessibilityIdentifier.accountSigningIn)
            }

            ProviderSignInButtons(
                prepareNonce: { store.prepareNonce() },
                rawNonce: { store.preparedNonce?.raw ?? "" },
                google: store.google,
                // Debug environments only, and only when the launch asked.
                fixtureCredential: store.allowsFakeSignIn
                    ? ProviderSignInButtons.fixtureCredential : nil,
                appleIdentifier: AccessibilityIdentifier.accountSignInApple,
                googleIdentifier: AccessibilityIdentifier.accountSignInGoogle,
                fixtureIdentifier: AccessibilityIdentifier.accountFakeSignIn,
                onCredential: { credential, profile in
                    Task { await store.signIn(with: credential, providerProfile: profile) }
                },
                onCancelled: { store.noteCancelledSignIn() },
                onFailure: { store.noteProviderFailure($0) }
            )

            if let failure = store.lastFailure {
                Text(failure == .offline ? L10n.accountSignInOffline : L10n.accountSignInFailed)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier(AccessibilityIdentifier.accountFailure)
            }

            smallPrint

            // The way out is a word, as guideline 9.1 asks: a guest declines
            // an account out loud, not by finding the edge of a sheet. Quiet
            // and set apart below the small print: it is the answer to the
            // offer, not a third button in the pair.
            Button(L10n.accountSignInNotNow) { dismiss() }
                .font(DesignTokens.Typography.body.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: DesignTokens.Layout.minimumTouchTarget)
                .padding(.top, DesignTokens.Spacing.medium)
                .accessibilityIdentifier(AccessibilityIdentifier.accountSignInNotNow)
        }
        .padding(.top, DesignTokens.Spacing.large)
        .padding(.horizontal, DesignTokens.Spacing.large)
        .padding(.bottom, DesignTokens.Spacing.small)
        .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
        .frame(maxWidth: .infinity)
        .background {
            UnevenRoundedRectangle(
                topLeadingRadius: DesignTokens.Radius.large + DesignTokens.Spacing.small,
                topTrailingRadius: DesignTokens.Radius.large + DesignTokens.Spacing.small,
                style: .continuous
            )
            .fill(Color(white: DesignTokens.SignIn.trayWhite))
            // The tray runs under the home indicator: a light surface that
            // stops short of the edge reads as a card, not as the floor.
            .ignoresSafeArea(edges: .bottom)
        }
        // The one light surface in the app, told so: the system controls on
        // it — the spinner, the secondary text — pick their light colours.
        .environment(\.colorScheme, .light)
        .devBlockID("signin.tray")
    }

    /// What signing in agrees to, and the two documents it agrees to, each
    /// opened in place the way the account screen opens them.
    @ViewBuilder
    private var smallPrint: some View {
        if privacyPolicyURL != nil || termsURL != nil {
            VStack(spacing: DesignTokens.Spacing.extraSmall) {
                Text(L10n.accountSignInLegal)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                HStack(spacing: DesignTokens.Spacing.medium) {
                    if let termsURL {
                        DocumentLink(title: L10n.accountTerms, url: termsURL)
                    }
                    if let privacyPolicyURL {
                        DocumentLink(title: L10n.accountPrivacyPolicy, url: privacyPolicyURL)
                    }
                }
                .buttonStyle(.plain)
                .font(DesignTokens.Typography.caption.weight(.semibold))
                .foregroundStyle(.primary)
            }
        }
    }
}
