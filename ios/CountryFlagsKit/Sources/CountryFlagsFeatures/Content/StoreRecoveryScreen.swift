import SwiftUI

import CountryFlagsDomain

/// What a launch says when the store would not open (#445).
///
/// The app runs on a fresh store by the time this is on screen, so it could
/// simply open. It does not: progress that was there yesterday is missing, and
/// an app that opens on an empty Home without a word reads as having lost it
/// for no reason. So the launch stops here once, says what happened and what
/// was kept, and goes on when the person has read it.
///
/// The same shape as the launch wait: a symbol, what happened, what it means,
/// one button. It is a screen rather than a sheet because there is nothing
/// behind it yet worth reaching.
struct StoreRecoveryScreen: View {
    let notice: StoreRecoveryNotice
    let proceed: () -> Void

    var body: some View {
        ZStack {
            AppScene()
                .ignoresSafeArea()
            GeometryReader { proxy in
                // Scrolls at the largest text sizes, where the explanation is
                // taller than the screen; centred otherwise.
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
            Button(L10n.storeRecoveryContinue, action: proceed)
                .buttonStyle(GlassProminentActionStyle())
                .accessibilityIdentifier(AccessibilityIdentifier.storeRecoveryContinue)
                .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
                .padding(.horizontal, DesignTokens.Spacing.large)
                .padding(.bottom, DesignTokens.Spacing.medium)
        }
    }

    private var content: some View {
        VStack(spacing: DesignTokens.Spacing.large) {
            Image(systemName: symbol)
                .font(DesignTokens.Typography.screenTitle)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.white.opacity(0.8))
                .accessibilityHidden(true)

            VStack(spacing: DesignTokens.Spacing.medium) {
                Text(title)
                    .font(DesignTokens.Typography.sectionTitle)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier(AccessibilityIdentifier.storeRecoveryTitle)

                ForEach(paragraphs, id: \.self) { paragraph in
                    Text(paragraph)
                        .font(DesignTokens.Typography.body)
                        .foregroundStyle(.white.opacity(0.7))
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(.vertical, DesignTokens.Spacing.extraLarge)
    }

    /// Two different troubles, two different shapes: a store that was
    /// replaced, and a device where nothing can be written at all.
    private var symbol: String {
        switch notice.outcome {
        case .startedFresh: "externaldrive.badge.exclamationmark"
        case .notSaving: "externaldrive.badge.xmark"
        }
    }

    private var title: String {
        switch notice.outcome {
        case .startedFresh: L10n.storeRecoveryFreshTitle
        case .notSaving: L10n.storeRecoveryNotSavingTitle
        }
    }

    /// What happened, then what it costs. The second paragraph of a fresh
    /// start is the honest part: a signed-in learner's progress comes back
    /// from the account, but unsent answers and a guest's work are in the
    /// kept copy, and this build cannot show them.
    private var paragraphs: [String] {
        switch notice.outcome {
        case .startedFresh:
            [L10n.storeRecoveryFreshMessage, L10n.storeRecoveryFreshConsequence]
        case .notSaving:
            [L10n.storeRecoveryNotSavingMessage]
        }
    }
}
