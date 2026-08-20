import SwiftUI

/// The pieces every screen is built out of.
///
/// They exist so that a deck, the catalogue, the progress screen and a session
/// are recognisably the same app: one card, one section label, two buttons and
/// one skeleton, defined once. A screen that needs something none of these
/// cover is a screen with a hero, and it draws that hero itself.

/// A pane of glass holding content.
///
/// The system's own liquid glass — what the iOS 26 floor was raised for. The
/// hand-drawn hairline is gone with the hand-rolled material: real glass
/// carries its own edge, and drawing a second one over it read as a smudge
/// outline rather than a rim.
struct GlassCard<Content: View>: View {
    var padding: CGFloat = DesignTokens.Spacing.medium
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .glassEffect(
                .regular,
                in: RoundedRectangle(cornerRadius: DesignTokens.Radius.large, style: .continuous)
            )
    }
}

/// The name of a group of things.
///
/// Small, spaced and quiet: it is read once on the way past, and anything
/// louder would compete with the content it is introducing.
struct SectionLabel: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(DesignTokens.Typography.caption.weight(.semibold))
            .textCase(.uppercase)
            .kerning(DesignTokens.Typography.labelKerning)
            .foregroundStyle(.white.opacity(0.55))
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The one thing a screen wants you to do.
///
/// White on a dark scene, which is the highest contrast the app has and is
/// therefore spent once per screen.
struct PrimaryActionStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(DesignTokens.Typography.body.weight(.semibold))
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity)
            .frame(minHeight: DesignTokens.Layout.actionHeight)
            .background(.white.opacity(isEnabled ? 1 : 0.4), in: Capsule(style: .continuous))
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: configuration.isPressed)
    }
}

/// Everything else a screen offers. Glass rather than white: it is available,
/// not recommended.
struct GlassActionStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(DesignTokens.Typography.body.weight(.medium))
            .foregroundStyle(.white.opacity(isEnabled ? 1 : 0.4))
            .frame(maxWidth: .infinity)
            .frame(minHeight: DesignTokens.Layout.actionHeight)
            .glassEffect(.regular.interactive(), in: Capsule(style: .continuous))
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: configuration.isPressed)
    }
}

/// The session chrome both study modes wear: the counter, the deck's name,
/// and the way out — capsules over the scene, one component so the two modes
/// cannot drift apart.
struct SessionHUD: View {
    let position: Int
    let total: Int
    /// The deck the learner is inside; hidden while it has not loaded.
    let deckName: String
    let onClose: () -> Void

    var body: some View {
        HStack {
            Text(L10n.studyProgress(position, total))
                .font(DesignTokens.Typography.caption.weight(.medium))
                .monospacedDigit()
                .contentTransition(.numericText())
                .foregroundStyle(.white)
                .padding(.horizontal, DesignTokens.Spacing.medium)
                .frame(minHeight: DesignTokens.Layout.minimumTouchTarget * 0.75)
                .glassEffect(.regular, in: Capsule())
                .accessibilityIdentifier(AccessibilityIdentifier.studyProgress)

            Spacer()

            if !deckName.isEmpty {
                Text(deckName)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(.white.opacity(0.65))
                    .lineLimit(1)
                    .accessibilityIdentifier(AccessibilityIdentifier.studyDeckName)
            }

            Spacer()

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(DesignTokens.Typography.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(
                        width: DesignTokens.Layout.minimumTouchTarget,
                        height: DesignTokens.Layout.minimumTouchTarget
                    )
                    .glassEffect(.regular, in: Circle())
            }
            .accessibilityLabel(L10n.studyClose)
            .accessibilityIdentifier(AccessibilityIdentifier.studyClose)
        }
    }
}

/// The shape content will take, shown before the content arrives.
///
/// The spec names the spinner over content as the thing not to build: a screen
/// that already knows its own shape takes it, and what loads arrives into the
/// shape instead of replacing it.
struct SkeletonBlock: View {
    var height: CGFloat = DesignTokens.Layout.actionHeight
    var radius: CGFloat = DesignTokens.Radius.large

    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(.ultraThinMaterial)
            .frame(height: height)
            .skeletonPulse()
    }
}

/// The breath a placeholder takes while its content is on the way.
///
/// A still skeleton is indistinguishable from a hang; the slow fade says the
/// screen is waiting, not stuck. With reduced motion the skeleton holds still,
/// as everything else does.
private struct SkeletonPulse: ViewModifier {
    @State private var isDimmed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(isDimmed ? 0.45 : 1)
            .animation(
                reduceMotion
                    ? nil
                    : .easeInOut(duration: 0.9).repeatForever(autoreverses: true),
                value: isDimmed
            )
            .onAppear { isDimmed = true }
    }
}

extension View {
    func skeletonPulse() -> some View {
        modifier(SkeletonPulse())
    }
}

extension View {
    /// Puts a screen on the app's ground.
    ///
    /// The scene is drawn per screen rather than once behind the whole stack:
    /// a navigation stack paints its own opaque background over anything
    /// underneath it, so a single scene held at the root is simply covered up.
    /// Every screen draws the same one, which is what makes them look like one
    /// surface anyway.
    ///
    /// The navigation bar keeps its buttons and its back gesture and loses only
    /// its background, so the scene runs under it too.
    func sceneChrome() -> some View {
        background { AppScene() }
            .toolbarBackground(.hidden, for: .navigationBar)
    }
}

/// A screen that scrolls on the app's ground.
///
/// Every browsing screen uses it, which is what keeps their margins, their
/// maximum width and their spacing identical without any of them saying so.
struct SceneScrollView<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.large) {
                content
            }
            .frame(maxWidth: DesignTokens.Layout.maximumContentWidth)
            .frame(maxWidth: .infinity)
            .padding(DesignTokens.Spacing.large)
        }
        .scrollIndicators(.hidden)
        .sceneChrome()
    }
}
