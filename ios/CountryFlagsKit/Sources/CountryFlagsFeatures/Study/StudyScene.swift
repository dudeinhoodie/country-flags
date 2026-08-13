import SwiftUI

/// The ground the session is played on: the current flag's own colours, out of
/// focus, over a dark base.
///
/// It changes with the card and is interpolated rather than switched, so the
/// move to the next country reads peripherally — the eye notices the room
/// changing colour before it reads the counter.
struct StudyScene: View {
    let palette: FlagPalette

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        ZStack {
            // A dark base rather than the system background: the flag is the
            // only thing on this screen that should look lit.
            Color.black.opacity(0.94)

            if !reduceTransparency {
                RadialGradient(
                    colors: [palette.primary.opacity(0.55), .clear],
                    center: .init(x: 0.2, y: 0.12),
                    startRadius: 0,
                    endRadius: 420
                )
                RadialGradient(
                    colors: [palette.secondary.opacity(0.45), .clear],
                    center: .init(x: 0.85, y: 0.3),
                    startRadius: 0,
                    endRadius: 420
                )
                RadialGradient(
                    colors: [palette.primary.opacity(0.28), .clear],
                    center: .init(x: 0.5, y: 1.0),
                    startRadius: 0,
                    endRadius: 380
                )
            }
        }
        .ignoresSafeArea()
        .animation(reduceMotion ? nil : .smooth(duration: 0.6), value: palette)
    }
}
