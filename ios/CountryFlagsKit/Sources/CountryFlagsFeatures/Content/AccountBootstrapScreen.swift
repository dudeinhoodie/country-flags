import SwiftUI

import CountryFlagsDomain

/// The wait before an account's first numbers arrive.
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
struct AccountBootstrapScreen: View {
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
        .accessibilityIdentifier(AccessibilityIdentifier.accountBootstrap)
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
                Text(failure == nil || isRetrying ? L10n.bootstrapTitle : L10n.bootstrapFailedTitle)
                    .font(DesignTokens.Typography.sectionTitle)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)

                Text(
                    failure == nil || isRetrying
                        ? L10n.bootstrapSubtitle
                        : L10n.bootstrapFailedSubtitle
                )
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.white.opacity(0.6))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)

            if failure != nil, !isRetrying {
                Button(L10n.bootstrapRetry) {
                    Task { await retry() }
                }
                .buttonStyle(GlassProminentActionStyle())
                .accessibilityIdentifier(AccessibilityIdentifier.accountBootstrapRetry)
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
