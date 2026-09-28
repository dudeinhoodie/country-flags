import AuthenticationServices
import SwiftUI

import CountryFlagsDomain

/// The account, as a section of the settings form.
///
/// A guest sees an offer, never a gate: their row says what is at stake — the
/// countries they have learned, counted, living on one phone — and the screen
/// it opens says the rest, while everything else in the app works without it.
/// Signing out with unsent answers is put to the user with the number,
/// because stranding work silently is the one thing this section must never
/// do.
struct AccountSection: View {
    /// Owned for the same reason every screen owns its store.
    @State private var store: AccountStore
    /// How many countries this guest has learned, when anybody knows. The
    /// note says what is at stake rather than what an account is for, and
    /// the difference is a number: "96 countries" is this learner's work,
    /// "your progress" is a category.
    private let learnedCountries: Int?
    /// Opens the account screen. Only a signed-in account has one worth
    /// opening, so the row appears with the person rather than with the offer.
    private let onOpenAccount: (() -> Void)?
    /// Asks for the sign-in screen. The section only asks: a sheet presented
    /// from inside a list is torn down whenever the list reloads under it,
    /// and this list reloads on every word from the store. The screen that
    /// owns the list presents it, above the list, where it stays.
    private let onSignIn: (() -> Void)?
    /// The learner's own flags, for the small pile beside the offer. The same
    /// three the sign-in screen throws, so the block and the screen it opens
    /// are about the same countries.
    private let fan: SignInFan?
    @State private var fanCards: [LearningCardRecord] = []

    init(
        store: AccountStore,
        learnedCountries: Int? = nil,
        onOpenAccount: (() -> Void)? = nil,
        onSignIn: (() -> Void)? = nil,
        fan: SignInFan? = nil
    ) {
        _store = State(wrappedValue: store)
        self.learnedCountries = learnedCountries
        self.onOpenAccount = onOpenAccount
        self.onSignIn = onSignIn
        self.fan = fan
    }

    var body: some View {
        Section {
            content
        } header: {
            SectionLabel(L10n.accountSection)
        } footer: {
            footer
        }
        .task { await store.start() }
        .task {
            if let fan { fanCards = await fan.cards() }
        }
        .confirmationDialog(
            signOutTitle,
            isPresented: signOutDialogBinding,
            titleVisibility: .visible
        ) {
            Button(L10n.accountSignOut, role: .destructive) {
                Task { await store.confirmSignOut(everywhere: false) }
            }
            .accessibilityIdentifier(AccessibilityIdentifier.accountSignOutConfirm)
            // A cancel-role button is omitted by the iPad/popover adaptation
            // of `confirmationDialog`, leaving only tap-outside dismissal.
            // This choice protects unsent work, so it stays an explicit action
            // on every size class instead of relying on hidden chrome.
            Button(L10n.accountCancel) {
                store.cancelSignOut()
            }
            .accessibilityIdentifier(AccessibilityIdentifier.accountSignOutCancel)
        }
    }

    @ViewBuilder
    private var content: some View {
        if let deletion = store.pendingDeletion {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                Text(L10n.accountDeletionPendingTitle)
                    .font(DesignTokens.Typography.body.weight(.semibold))
                    .foregroundStyle(.white)
                Text(L10n.accountDeletionPendingBody(Self.day(deletion.expectedCompletionAt)))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.7))
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(AccessibilityIdentifier.settingsDeletionPending)
        }

        switch store.state {
        case .guest:
            signInControls
        case .authenticating:
            HStack(spacing: DesignTokens.Spacing.small) {
                ProgressView()
                Text(L10n.accountSigningIn)
                    .foregroundStyle(.white.opacity(0.7))
            }
            .accessibilityIdentifier(AccessibilityIdentifier.accountSigningIn)
        case .authenticated:
            // The person, not a status line: their picture and their name,
            // with what the account buys them as the caption underneath.
            HStack(spacing: DesignTokens.Spacing.medium) {
                AccountAvatarView(profile: store.profile)

                VStack(alignment: .leading, spacing: 0) {
                    Text(store.profile?.displayName ?? L10n.accountFallbackName)
                        .font(DesignTokens.Typography.body.weight(.semibold))
                        .foregroundStyle(.white)
                    Text(L10n.accountSignedIn)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
            .frame(minHeight: DesignTokens.Layout.minimumTouchTarget)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(AccessibilityIdentifier.accountSignedIn)

            if let onOpenAccount {
                Button(L10n.accountOpen, action: onOpenAccount)
                    .accessibilityIdentifier(AccessibilityIdentifier.accountOpen)
            }

            Button(L10n.accountSignOut, role: .destructive) {
                Task { await store.requestSignOut() }
            }
            .accessibilityIdentifier(AccessibilityIdentifier.accountSignOut)
        case .authenticationExpired:
            Label(L10n.accountExpired, systemImage: "person.crop.circle.badge.exclamationmark")
                .foregroundStyle(.white.opacity(0.8))
                .accessibilityIdentifier(AccessibilityIdentifier.accountExpired)

            signInControls
        }
    }

    /// The offer: what an account keeps, the learner's own flags beside it,
    /// and one button in the app's own style that opens the screen where the
    /// brands' buttons are.
    ///
    /// The brand buttons used to stand here, two capsules on the scene. Two
    /// white pills in a settings form read as somebody else's controls set
    /// down among this app's rows; the app's primary action is this app's,
    /// and the buttons keep their brands on a screen that is about them.
    @ViewBuilder
    private var signInControls: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.medium) {
            HStack(spacing: DesignTokens.Spacing.medium) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall / 2) {
                    Text(isExpired ? L10n.accountSignInAgain : L10n.accountSignInBlockTitle)
                        .font(DesignTokens.Typography.body.weight(.semibold))
                        .foregroundStyle(.white)
                    Text(signInCaption)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.6))
                }

                Spacer(minLength: 0)

                if let fan, !fanCards.isEmpty {
                    FlagFanView(cards: fanCards, store: fan.content, assets: fan.assets)
                }
            }

            // Lit glass rather than the white slab: the account screen is a
            // form, and the offer is one row of it, not the screen's hero.
            Button(L10n.accountSignInRow) { onSignIn?() }
                .buttonStyle(GlassProminentActionStyle())
                .accessibilityIdentifier(AccessibilityIdentifier.accountSignInRow)
        }
        .padding(.vertical, DesignTokens.Spacing.small)
        .devBlockID("account.offer")
    }

    private var isExpired: Bool {
        if case .authenticationExpired = store.state { return true }
        return false
    }

    /// What is at stake, under the name of the row: the countries this guest
    /// has learned, counted, or — for a sign-in the backend stopped
    /// honouring — the sync that waits on it.
    private var signInCaption: String {
        if isExpired { return L10n.accountSignInRowExpired }
        return (learnedCountries ?? 0) > 0
            ? L10n.accountGuestNoteCount(learnedCountries ?? 0)
            : L10n.accountGuestNote
    }

    @ViewBuilder
    private var footer: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
            if let failure = store.lastFailure {
                Text(failure == .offline ? L10n.accountSignInOffline : L10n.accountSignInFailed)
                    .accessibilityIdentifier(AccessibilityIdentifier.accountFailure)
            }
            migrationLine
        }
        .foregroundStyle(.white.opacity(0.5))
    }

    @ViewBuilder
    private var migrationLine: some View {
        switch store.migration {
        case .imported(let result):
            Text(L10n.accountMigrationImported(result.acceptedEventCount))
                .accessibilityIdentifier(AccessibilityIdentifier.accountMigrationImported)
        case .pending:
            Text(L10n.accountMigrationPending)
        case .failed:
            Text(L10n.accountMigrationFailed)
        case .nothingToImport, .refused, .unavailable, nil:
            // Nothing to say: no work moved because there was none to move,
            // or the attempt will simply repeat. A settings footer is not a
            // place to narrate mechanics that resolved themselves.
            EmptyView()
        }
    }

    /// Days rather than instants: the hour an account finishes being deleted
    /// is precision nobody acts on.
    private static func day(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .omitted)
    }

    private var signOutTitle: String {
        guard let assessment = store.signOutAssessment, assessment.requiresWarning else {
            return L10n.accountSignOutClean
        }
        return L10n.accountSignOutWarning(assessment.unsyncedCount)
    }

    private var signOutDialogBinding: Binding<Bool> {
        Binding(
            get: { store.signOutAssessment != nil },
            set: { isPresented in
                if !isPresented { store.cancelSignOut() }
            }
        )
    }
}

/// The account's picture, or the person's initial while there is none.
///
/// The picture is fetched from the provider's URL each time: an avatar
/// changed on the account changes here without any store of ours holding a
/// stale copy. The monogram fallback keeps the circle a person rather than
/// a generic glyph.
private struct AccountAvatarView: View {
    let profile: AccountProfile?

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        ZStack {
            Circle().fill(.ultraThinMaterial)

            if let initial {
                Text(initial)
                    .font(DesignTokens.Typography.body.weight(.semibold))
                    .foregroundStyle(.white)
            } else {
                Image(systemName: "person.fill")
                    .foregroundStyle(.white.opacity(0.7))
            }

            if let url = profile?.avatarURL {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color.clear
                }
            }
        }
        .frame(
            width: DesignTokens.Layout.minimumTouchTarget,
            height: DesignTokens.Layout.minimumTouchTarget
        )
        .clipShape(Circle())
        .overlay {
            Circle().strokeBorder(
                .white.opacity(DesignTokens.Card.borderOpacity),
                lineWidth: 1 / displayScale
            )
        }
        .accessibilityHidden(true)
    }

    private var initial: String? {
        guard let name = profile?.displayName?.trimmingCharacters(in: .whitespaces),
            let first = name.first
        else {
            return nil
        }
        return String(first).uppercased()
    }
}

/// Google's "G", as Google ships it.
///
/// The one thing on the button that is not drawn here. Since 2025 the mark
/// is a gradient — a conic sweep under a blur — that no vector format the
/// toolchain renders can carry, so it travels as the bitmap Google publishes
/// in its sign-in asset pack: the 20-point logo square cropped out of the
/// icon-only light button, at 2x and 3x, white ground included. That ground
/// is why the mark may sit only on a white button. A trademark keeps its
/// shape and its colours the way a flag does; nothing here is ours to adjust.
struct GoogleLogoMark: View {
    var body: some View {
        Image("google-g-neutral", bundle: .module)
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .accessibilityHidden(true)
    }
}

/// The person in the top corner: the way into the account from anywhere.
///
/// A plain symbol, the same weight and treatment as the gear across the bar
/// from it — the two are a pair, and a frosted disc on one side against a bare
/// glyph on the other made them look like two different kinds of control. The
/// provider's picture takes its place once there is one: a face is worth more
/// than a symbol, and only then is the disc earned.
/// The avatar in the navigation bar.
///
/// Draws bytes the store already holds rather than fetching its own. It is
/// the same picture on the toolbar of all three tabs, and `AsyncImage` fetches
/// per instance: switching tabs blinked the photo back to the grey glyph and
/// in again, on an image the app had in hand.
struct AccountAvatarButtonLabel: View {
    let profile: AccountProfile?
    let avatar: Data?

    var body: some View {
        if let avatar, let image = UIImage(data: avatar) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: 28, height: 28)
                .clipShape(Circle())
                .overlay {
                    Circle()
                        .strokeBorder(
                            .white.opacity(DesignTokens.Card.borderOpacity),
                            lineWidth: 1
                        )
                }
        } else {
            // An account with no picture, and an account whose picture has
            // not arrived, look the same. Neither is worth a spinner in a
            // navigation bar.
            glyph
        }
    }

    private var glyph: some View {
        Image(systemName: "person.crop.circle")
    }
}
