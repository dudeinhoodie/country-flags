import SwiftUI

import CountryFlagsDomain

/// The training that was left half-finished, as one line.
///
/// Deliberately not a second hero. The queue's pane is what the day is about;
/// this is a door back into something already started, and a door does not
/// need the same weight as a room. The bar carries the state — how far in the
/// person got — so the row needs no big number to be understood at a glance,
/// and the chevron says where it leads.
struct ResumeTrainingRow: View {
    let deckName: String
    let answered: Int
    let total: Int
    let action: () -> Void

    private var fraction: Double {
        guard total > 0 else { return 0 }
        return min(1, Double(answered) / Double(total))
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: DesignTokens.Spacing.medium) {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.small) {
                    HStack(spacing: DesignTokens.Spacing.small) {
                        Text(L10n.homeSessionInProgress)
                            .font(DesignTokens.Typography.body.weight(.semibold))
                            .foregroundStyle(.white)

                        if !deckName.isEmpty {
                            Text(verbatim: "·")
                                .foregroundStyle(.white.opacity(0.4))
                            Text(deckName)
                                .font(DesignTokens.Typography.body)
                                .foregroundStyle(.white.opacity(0.7))
                                .lineLimit(1)
                        }
                    }

                    bar

                    Text(L10n.homeSessionLeft(max(0, total - answered)))
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.55))
                }

                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.4))
            }
            .padding(DesignTokens.Spacing.medium)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassEffect(
                .regular,
                in: RoundedRectangle(
                    cornerRadius: DesignTokens.Radius.large,
                    style: .continuous
                )
            )
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AccessibilityIdentifier.homeContinue)
        .accessibilityAddTraits(.isButton)
    }

    /// How far in the person got. Two capsules rather than a `ProgressView`:
    /// the system's bar brings its own tint and its own height, and this one
    /// has to sit at the weight of a caption.
    private var bar: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.15))
                Capsule()
                    .fill(.white)
                    .frame(width: proxy.size.width * fraction)
            }
        }
        .frame(height: DesignTokens.Layout.progressBarHeight)
        .accessibilityHidden(true)
    }
}
