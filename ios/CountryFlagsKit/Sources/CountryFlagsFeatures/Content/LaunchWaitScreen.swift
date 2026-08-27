import SwiftUI

import CountryFlagsDomain

/// The wait before the app has anything it is allowed to draw.
///
/// An account's counts are the backend's (ADR-016), so between signing in
/// and the first answer there is a moment when the app has nothing it is
/// allowed to draw. It used to spend that moment as an empty shelf behind a
/// working tab bar, which reads as a broken app rather than a busy one —
/// especially against a deployment that scales to zero and takes a few
/// seconds to wake.
///
/// It is a screen rather than a spinner over the content: there is nothing
/// behind it worth showing, and a tab bar that leads to three empty rooms is
/// worse than a door that says "one moment".
struct LaunchWaitScreen: View {
    /// What is being waited for — which is the whole reason this screen has
    /// words on it. Telling a guest their account is being prepared names
    /// something they do not have, over work that is not happening.
    enum Reason: Equatable {
        /// Nothing has been read yet, so the flags themselves are what is on
        /// the way. Everyone's first launch begins here, and a guest's every
        /// wait ends here: nobody is counting a guest's work but the device.
        case catalog
        /// An account whose counts have never arrived. Only a signed-in
        /// learner waits on this, and only until the backend answers once.
        case account

        /// What a launch is waiting for, given what the two stores hold — or
        /// nil when it waits for nothing and the app can be let in.
        ///
        /// A free function of the state rather than a property of the view,
        /// so the rule can be checked without a screen.
        static func waiting(
            hasCatalog: Bool,
            isGuest: Bool?,
            origin: ProgressOrigin
        ) -> Self? {
            // The catalogue first: with nothing to draw there is no screen to
            // put numbers on, and this is the only wait a first launch shows.
            guard hasCatalog else { return .catalog }
            guard origin == .awaitingBackend else { return nil }
            // Only an account waits for numbers. Until the store has resolved
            // whose they are the wait continues — letting the app in a frame
            // early is what #247 fixed — but under the wording that does not
            // claim an account the learner may not have.
            return isGuest == false ? .account : .catalog
        }
    }

    let reason: Reason
    /// Whether the last attempt failed. The wait must be able to end: a
    /// backend that never answers would otherwise spin forever.
    let failure: SyncFailure?
    let isRetrying: Bool
    let environment: String?
    let retry: () async -> Void

    var body: some View {
        ZStack {
            AppScene()
                .ignoresSafeArea()
            content
                .padding(.horizontal, DesignTokens.Spacing.large)
        }
        .accessibilityIdentifier(AccessibilityIdentifier.launchWait)
    }

    /// The failure is reported the same way whichever wait it interrupted —
    /// the server is what could not be reached — but what is reassuring
    /// depends on what the learner has: an account has progress that is safe
    /// somewhere, and a first launch has none to speak of.
    private var isWaiting: Bool { failure == nil || isRetrying }

    private var title: String {
        guard isWaiting else { return L10n.launchFailedTitle }
        switch reason {
        case .catalog: return L10n.launchCatalogTitle
        case .account: return L10n.launchAccountTitle
        }
    }

    private var subtitle: String {
        switch (isWaiting, reason) {
        case (true, .catalog): return L10n.launchCatalogSubtitle
        case (true, .account): return L10n.launchAccountSubtitle
        case (false, .catalog): return L10n.launchCatalogFailedSubtitle
        case (false, .account): return L10n.launchAccountFailedSubtitle
        }
    }

    @ViewBuilder
    private var content: some View {
        VStack(spacing: DesignTokens.Spacing.large) {
            if failure == nil || isRetrying {
                ProgressView()
                    .controlSize(.large)
                    .tint(.white)
            } else {
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 34))
                    .foregroundStyle(.white.opacity(0.75))
                    .accessibilityHidden(true)
            }

            VStack(spacing: DesignTokens.Spacing.small) {
                Text(title)
                    .font(DesignTokens.Typography.sectionTitle)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)

                Text(subtitle)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.6))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)

            if failure != nil, !isRetrying {
                Button(L10n.launchRetry) {
                    Task { await retry() }
                }
                .buttonStyle(GlassProminentActionStyle())
                .accessibilityIdentifier(AccessibilityIdentifier.launchWaitRetry)
            }

            if let environment {
                Text(environment)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.4))
            }
        }
        .accessibilityElement(children: .contain)
    }
}
