import SwiftUI

/// A word about the account, as one line on the home screen.
///
/// Two occasions, one shape. A sign-in the backend no longer honours: the
/// answers are piling up on the phone, and until now nothing said so anywhere
/// the learner looks. And a guest with something to lose: countries learned
/// on this phone and nowhere else. Neither is a hero and neither is a gate.
/// The row is a door to the account screen, where the buttons already are,
/// drawn like the door back into an unfinished sitting so the two read as the
/// same kind of thing: a line, a reason, a chevron.
struct AccountPromptRow: View {
    let symbol: String
    let title: String
    let caption: String
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: DesignTokens.Spacing.medium) {
                Image(systemName: symbol)
                    .font(.title3)
                    .foregroundStyle(.white)
                    .frame(width: DesignTokens.Spacing.large)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: DesignTokens.Spacing.extraSmall / 2) {
                    Text(title)
                        .font(DesignTokens.Typography.body.weight(.semibold))
                        .foregroundStyle(.white)
                    Text(caption)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(.white.opacity(0.55))
                }

                Spacer(minLength: 0)

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
        .accessibilityIdentifier(identifier)
        .accessibilityAddTraits(.isButton)
    }
}
