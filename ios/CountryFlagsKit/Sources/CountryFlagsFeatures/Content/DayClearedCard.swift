import SwiftUI

import CountryFlagsDomain

/// The day's queue, cleared.
///
/// The same pane as the day's queue, in its other state — a label, one number,
/// a caption, an action — because it stands in the same place and answers the
/// same question. The label names the figure, the way it does on every other
/// pane in the app; there is no separate "всё повторено" headline, because it
/// said what the seal already says in colour and left the number unnamed.
///
/// The seal sits beside the figure rather than beside the words. Beside the
/// words it took fifty-odd points of width from the longest line on the card —
/// the one that wraps — and on a narrow screen the two collided. Beside the
/// number it takes width from nothing: digits do not wrap, and the mark and the
/// figure read as one object rather than as two columns.
///
/// There used to be two numbers of the same size side by side, and they were
/// not the same kind of thing: how many countries you know is the whole
/// journey, how many are still settling is today's draft. Two heroes on one
/// card means neither is read, so the total is the only large number and the
/// draft is a quiet line under it.
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
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                    SectionLabel(L10n.homeClearedLearned)
                    total
                }
                .accessibilityElement(children: .combine)

                if let onOpenCatalog { next(onOpenCatalog) }
            }
        }
        .accessibilityIdentifier(AccessibilityIdentifier.homeDueEmpty)
    }

    /// The mark and the figure on one line, the draft under them.
    private var total: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall) {
            HStack(alignment: .center, spacing: DesignTokens.Spacing.small) {
                seal

                Text("\(learned)")
                    .font(DesignTokens.Typography.heroNumber)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .foregroundStyle(.white)
            }

            if inProgress > 0 {
                Text(L10n.homeClearedInProgressCount(inProgress))
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.55))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// The one spot of colour in the app, spent on the one moment that earns
    /// it. Palette rendering keeps the tick readable against the seal rather
    /// than flattening the whole glyph to green.
    private var seal: some View {
        Image(systemName: "checkmark.seal.fill")
            .font(.system(size: 34))
            .symbolRenderingMode(.palette)
            .foregroundStyle(.black.opacity(0.75), Color.green)
            .accessibilityHidden(true)
    }

    private func next(_ openCatalog: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
            // The reassurance and the offer in one breath. They used to be a
            // section label, a sentence and a button — three weights for one
            // quiet thought at the bottom of a card about being finished.
            Text(L10n.homeClearedSubtitle)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(.white.opacity(0.55))
                .fixedSize(horizontal: false, vertical: true)

            // The same lit glass a deck's "start training" wears: this is the
            // one thing the screen is offering, and on a day with nothing due
            // it is the only thing there is to do.
            Button(L10n.homeOpenCatalog, action: openCatalog)
                .buttonStyle(GlassProminentActionStyle())
                .accessibilityIdentifier(AccessibilityIdentifier.homeOpenCatalog)
        }
    }
}
