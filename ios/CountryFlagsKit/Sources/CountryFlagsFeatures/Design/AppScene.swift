import SwiftUI

/// The ground the whole app is played on: colour out of focus over a dark base.
///
/// It belongs to the app rather than to a screen. During a session it is lit by
/// the flag currently on the card and changes with it, so the move to the next
/// country reads peripherally — the eye notices the room changing colour before
/// it reads the counter. Everywhere else it is lit by the app's own two
/// colours, which is what makes the catalogue, a deck and the settings look
/// like the same place as the session.
struct AppScene: View {
    var palette: ScenePalette = .brand
    /// Whether the lights wander. Only the session asks for it: its ground is
    /// lit by the flag and a slow drift makes the room feel inhabited — the
    /// browsing screens hold still under their content.
    var drifts: Bool = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        if drifts && !reduceMotion && !reduceTransparency {
            TimelineView(.animation(minimumInterval: 1 / 20)) { context in
                lights(at: context.date.timeIntervalSinceReferenceDate)
            }
        } else {
            lights(at: 0)
        }
    }

    /// The lamps' positions at one instant. The drift moves each lamp on its
    /// own slow ellipse — different speeds, so the pattern never repeats
    /// visibly — and never touches the colours: the gamut is the flag's, the
    /// wandering is the room's.
    private func lights(at time: TimeInterval) -> some View {
        ZStack {
            // A dark base rather than the system background: the flag is the
            // only thing in this app that should look lit.
            Color.black.opacity(DesignTokens.Scene.baseOpacity)

            if !reduceTransparency {
                RadialGradient(
                    colors: [palette.primary.opacity(0.55 * palette.intensity), .clear],
                    center: .init(
                        x: 0.2 + 0.14 * sin(time * 0.5),
                        y: 0.12 + 0.1 * cos(time * 0.34)
                    ),
                    startRadius: 0,
                    endRadius: DesignTokens.Scene.lightRadius
                )
                RadialGradient(
                    colors: [palette.secondary.opacity(0.45 * palette.intensity), .clear],
                    center: .init(
                        x: 0.85 + 0.13 * sin(time * 0.31 + 2),
                        y: 0.3 + 0.12 * cos(time * 0.43 + 1)
                    ),
                    startRadius: 0,
                    endRadius: DesignTokens.Scene.lightRadius
                )
                RadialGradient(
                    colors: [palette.primary.opacity(0.28 * palette.intensity), .clear],
                    center: .init(
                        x: 0.5 + 0.16 * sin(time * 0.27 + 4),
                        y: 1.0 + 0.08 * cos(time * 0.39 + 3)
                    ),
                    startRadius: 0,
                    endRadius: DesignTokens.Scene.groundLightRadius
                )
            }
        }
        .ignoresSafeArea()
        .animation(reduceMotion ? nil : .smooth(duration: 0.6), value: palette)
    }
}
