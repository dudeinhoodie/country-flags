import AuthenticationServices
import SwiftUI

import CountryFlagsDomain

/// The account, as a section of the settings form.
///
/// A guest sees an offer, never a gate: the note under the buttons says what
/// is at stake — the countries they have learned, counted, living on one
/// phone — and everything else in the app works without it. Signing out with unsent answers is put to the
/// user with the number, because stranding work silently is the one thing
/// this section must never do.
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

    init(
        store: AccountStore,
        learnedCountries: Int? = nil,
        onOpenAccount: (() -> Void)? = nil
    ) {
        _store = State(wrappedValue: store)
        self.learnedCountries = learnedCountries
        self.onOpenAccount = onOpenAccount
    }

    var body: some View {
        Section {
            content
        } header: {
            // Headed by what it offers, not by what it is about: "Account"
            // over two sign-in buttons, on a screen already titled Account,
            // says nothing.
            SectionLabel(isSignedOut ? L10n.accountSignInSection : L10n.accountSection)
        } footer: {
            footer
        }
        .task { await store.start() }
        .confirmationDialog(
            signOutTitle,
            isPresented: signOutDialogBinding,
            titleVisibility: .visible
        ) {
            Button(L10n.accountSignOut, role: .destructive) {
                Task { await store.confirmSignOut(everywhere: false) }
            }
            Button(L10n.accountSignOutEverywhere, role: .destructive) {
                Task { await store.confirmSignOut(everywhere: true) }
            }
            Button(L10n.accountCancel, role: .cancel) {
                store.cancelSignOut()
            }
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

    /// Whether this is somebody with no account rather than somebody with
    /// one — the sign-in block is headed and laid out differently.
    private var isSignedOut: Bool {
        switch store.state {
        case .guest, .authenticationExpired: true
        default: false
        }
    }

    /// One row rather than one per button, on the scene rather than on a
    /// material slab.
    ///
    /// Left to the form, each button became its own row: two capsules on two
    /// grey rectangles, separated by the list's own spacing — which is not
    /// what a pair of capsules is. They are one offer, so they are one row,
    /// and the ground under them is the app's scene, which is what makes a
    /// capsule read as a capsule.
    @ViewBuilder
    private var signInControls: some View {
        VStack(spacing: DesignTokens.Spacing.small + 4) {
            providerButtons
        }
        .listRowBackground(Color.clear)
        .listRowInsets(
            EdgeInsets(
                top: DesignTokens.Spacing.small,
                leading: 0,
                bottom: DesignTokens.Spacing.small,
                trailing: 0
            )
        )
    }

    @ViewBuilder
    private var providerButtons: some View {
        ProviderSignInButtons(
            prepareNonce: { store.prepareNonce() },
            rawNonce: { store.preparedNonce?.raw ?? "" },
            google: store.google,
            // Debug environments only, and only when the launch asked for it.
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
    }

    @ViewBuilder
    private var footer: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
            if case .guest = store.state {
                // Somebody who has learned nothing yet is told what a guest
                // account is, not that nothing is at stake.
                Text(
                    (learnedCountries ?? 0) > 0
                        ? L10n.accountGuestNoteCount(learnedCountries ?? 0)
                        : L10n.accountGuestNote
                )
            }
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

/// Google's four-colour "G", drawn rather than shipped.
///
/// Four arcs and the bar, in the brand's own colours — a trademark keeps its
/// palette the way a flag does, so the hex values here are the logo's, not
/// ours. Drawing it keeps the mark crisp at any size with no asset to age.
struct GoogleLogoMark: View {
    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            let line = side * 0.21
            let inset = line / 2

            ZStack {
                segment(0.00, 0.17, Color(red: 0.259, green: 0.522, blue: 0.957), line: line)
                segment(0.17, 0.38, Color(red: 0.204, green: 0.659, blue: 0.325), line: line)
                segment(0.38, 0.62, Color(red: 0.984, green: 0.737, blue: 0.020), line: line)
                segment(0.62, 0.87, Color(red: 0.918, green: 0.263, blue: 0.208), line: line)

                // The bar that turns the ring into a G.
                Rectangle()
                    .fill(Color(red: 0.259, green: 0.522, blue: 0.957))
                    .frame(width: side / 2 - inset + line / 2, height: line)
                    .offset(x: side / 4 - inset / 2 + line / 4)
            }
            .padding(inset)
            .frame(width: side, height: side)
        }
    }

    /// One arc of the ring. Trim runs from 3 o'clock, clockwise on screen.
    private func segment(
        _ from: CGFloat, _ to: CGFloat, _ color: Color, line: CGFloat
    ) -> some View {
        Circle()
            .trim(from: from, to: to)
            .stroke(color, lineWidth: line)
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
