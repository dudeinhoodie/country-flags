import SwiftUI

import CountryFlagsDomain

/// The screen a build the backend no longer supports stops at (#447).
///
/// It cannot be dismissed: the backend has said this build must not go on,
/// and a way around the screen would be a way around that. The store and the
/// progress in it are untouched; the update picks them up where they are.
///
/// The same shape as the launch wait: a symbol, what happened, what to do,
/// one button. The button opens the app's App Store page. A build configured
/// without the App Store identifier has no page to open and offers no button;
/// the words still say where the update is.
struct UpdateRequiredScreen: View {
    let appStoreURL: URL?

    @Environment(\.openURL) private var openURL

    var body: some View {
        ZStack {
            AppScene()
                .ignoresSafeArea()
            GeometryReader { proxy in
                // Scrolls at the largest text sizes; centred otherwise.
                ScrollView {
                    content
                        .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
                        .frame(maxWidth: .infinity, minHeight: proxy.size.height)
                        .padding(.horizontal, DesignTokens.Spacing.large)
                }
                .scrollBounceBehavior(.basedOnSize)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if let appStoreURL {
                Button(L10n.updateOpenAppStore) {
                    openURL(appStoreURL)
                }
                .buttonStyle(GlassProminentActionStyle())
                .accessibilityIdentifier(AccessibilityIdentifier.updateRequiredOpenStore)
                .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
                .padding(.horizontal, DesignTokens.Spacing.large)
                .padding(.bottom, DesignTokens.Spacing.medium)
            }
        }
    }

    private var content: some View {
        VStack(spacing: DesignTokens.Spacing.large) {
            Image(systemName: "arrow.down.app")
                .font(DesignTokens.Typography.screenTitle)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.white.opacity(0.8))
                .accessibilityHidden(true)

            VStack(spacing: DesignTokens.Spacing.medium) {
                Text(L10n.updateRequiredTitle)
                    .font(DesignTokens.Typography.sectionTitle)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier(AccessibilityIdentifier.updateRequiredTitle)

                Text(L10n.updateRequiredMessage)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, DesignTokens.Spacing.extraLarge)
    }
}
