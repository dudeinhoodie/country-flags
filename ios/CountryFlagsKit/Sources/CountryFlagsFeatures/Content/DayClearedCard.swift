import SwiftUI

import CountryFlagsDomain

/// The day's queue, cleared.
///
/// The screen that says "nothing to review" is saying the learner did the
/// thing the app exists for, and a grey caption says that the way an empty
/// mailbox says it. So the pane keeps the shape of the one it replaces — a
/// label, a number, an action — and fills it with what was actually achieved:
/// the seal, the countries carried to learned, and somewhere to go for a
/// person who wants to keep going anyway.
///
/// The number is the whole world's total rather than today's tally: a day's
/// count drops back to zero tomorrow, and this pane is read on exactly the
/// days when the learner has earned something that lasts.
struct DayClearedCard: View {
    let learned: Int
    let inProgress: Int
    let onOpenCatalog: (() -> Void)?

    var body: some View {
        GlassCard(padding: DesignTokens.Spacing.large) {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.large) {
                headline
                if learned > 0 || inProgress > 0 { tally }
                if let onOpenCatalog { next(onOpenCatalog) }
            }
        }
        // One pane, one announcement: VoiceOver reads the achievement and the
        // numbers as a sentence rather than as six separate stops — the way a
        // sighted reader takes it in.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AccessibilityIdentifier.homeDueEmpty)
    }

    private var headline: some View {
        HStack(alignment: .top, spacing: DesignTokens.Spacing.medium) {
            // The one spot of colour on the screen, spent on the one moment
            // that deserves it. Palette rendering keeps the tick readable
            // against the seal rather than tinting the whole glyph flat.
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 36))
                .symbolRenderingMode(.palette)
                .foregroundStyle(.black.opacity(0.75), Color.green)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
                Text(L10n.homeClearedTitle)
                    .font(DesignTokens.Typography.sectionTitle)
                    .foregroundStyle(.white)

                Text(L10n.homeClearedSubtitle)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.65))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var tally: some View {
        HStack(alignment: .top, spacing: DesignTokens.Spacing.large) {
            stat(learned, label: L10n.homeClearedLearned)

            if inProgress > 0 {
                // A hairline rather than a full divider: the two numbers are
                // one thought — where the learner stands — not two sections.
                Rectangle()
                    .fill(.white.opacity(DesignTokens.Card.borderOpacity))
                    .frame(width: 1)
                    .frame(maxHeight: .infinity)

                stat(inProgress, label: L10n.homeClearedInProgress)
            }

            Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func stat(_ value: Int, label: String) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
            Text("\(value)")
                .font(DesignTokens.Typography.heroNumber)
                .monospacedDigit()
                .foregroundStyle(.white)

            Text(label)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.white.opacity(0.55))
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    private func next(_ openCatalog: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
            SectionLabel(L10n.homeClearedNext)

            Text(L10n.homeClearedSuggestion)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(.white.opacity(0.8))
                .fixedSize(horizontal: false, vertical: true)

            // Glass, not white: the day's work is done, so this is an offer
            // rather than the thing the screen is asking for.
            Button(L10n.homeOpenCatalog, action: openCatalog)
                .buttonStyle(GlassActionStyle())
                .accessibilityIdentifier(AccessibilityIdentifier.homeOpenCatalog)
        }
    }
}
