import SwiftUI

/// A finished day, said calmly (#516).
///
/// It used to be a title and a line inside the known/learned card: "На
/// сегодня всё" and "Норма дня — 50 стран. Повторения вернутся завтра." The
/// owner found the words strange (2026-11-04): "норма" is the app's word, not
/// the learner's, and "вернутся" promised nothing anyone could use. Now it is
/// a glass row of its own — a closed ring, "Сегодня всё сделано", and how far
/// the day went against the allowance — with no button: there is nothing left
/// to press today, so the screen offers nothing white.
struct HomeDayDone: View {
    /// Distinct cards answered today, at most the allowance.
    let answered: Int
    let limit: Int

    var body: some View {
        GlassCard(padding: DesignTokens.Spacing.medium) {
            HStack(spacing: DesignTokens.Spacing.medium) {
                Image(systemName: "checkmark.circle")
                    .font(DesignTokens.Typography.heroNumber.weight(.regular))
                    .foregroundStyle(.white.opacity(0.85))
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(L10n.homeDayDoneTitle)
                        .font(DesignTokens.Typography.sectionTitle)
                        .foregroundStyle(.white)
                    Text(L10n.homeDayDoneLine(answered: answered, limit: limit))
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.6))
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AccessibilityIdentifier.homeDayDone)
    }
}
