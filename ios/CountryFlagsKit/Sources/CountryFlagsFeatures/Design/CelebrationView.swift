import SwiftUI

import CountryFlagsDomain

/// A quiet fall of sparks for a finished deck.
///
/// Deliberately not confetti: a few dozen small motes in white and warm
/// gold, drifting down once behind the result and gone — the visual
/// register of a toast raised, not a piñata burst. Everything about it is
/// restraint: the particles are small, the palette is two colours, the fall
/// is slow, and it never repeats or loops. Under reduced motion nothing
/// moves — the result's own arrival is the celebration.
struct CelebrationView: View {
    @State private var start: Date?
    @State private var isFinished = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Deterministic sparks: seeded, so the shower is designed rather than
    /// rolled, and every finish looks equally considered.
    private static let motes: [Mote] = {
        var generator = SeededRandomNumberGenerator(seed: 20)
        return (0..<34).map { _ in Mote(using: &generator) }
    }()

    var body: some View {
        if !reduceMotion && !isFinished {
            TimelineView(.animation) { context in
                Canvas { graphics, size in
                    guard let start else { return }
                    var canvas = graphics
                    let elapsed = context.date.timeIntervalSince(start)
                    for mote in Self.motes {
                        mote.draw(in: &canvas, size: size, at: elapsed)
                    }
                }
            }
            .allowsHitTesting(false)
            .onAppear { start = Date() }
            .task {
                // The shower is over; the timeline has no reason to keep
                // asking for frames under a screen that has settled.
                try? await Task.sleep(for: .seconds(Mote.showerDuration))
                isFinished = true
            }
        }
    }
}

/// One spark: where it starts, how it falls, when it lives.
private struct Mote {
    static let showerDuration: TimeInterval = 4.5

    let x: Double
    let delay: TimeInterval
    let lifetime: TimeInterval
    let size: Double
    let swayAmplitude: Double
    let swayPhase: Double
    let isGold: Bool

    init(using generator: inout SeededRandomNumberGenerator) {
        x = Double.random(in: 0.05...0.95, using: &generator)
        delay = Double.random(in: 0...1.4, using: &generator)
        lifetime = Double.random(in: 2.2...3, using: &generator)
        size = Double.random(in: 2...4.5, using: &generator)
        swayAmplitude = Double.random(in: 6...18, using: &generator)
        swayPhase = Double.random(in: 0...(2 * .pi), using: &generator)
        isGold = Bool.random(using: &generator)
    }

    func draw(in canvas: inout GraphicsContext, size: CGSize, at elapsed: TimeInterval) {
        let life = elapsed - delay
        guard life > 0, life < lifetime else { return }
        let progress = life / lifetime

        // Eased fall — fast enough to read as falling, slow enough to read
        // as expensive — with a gentle sway, like dust in a shaft of light.
        let eased = 1 - pow(1 - progress, 2)
        let cx = x * size.width + sin(life * 1.8 + swayPhase) * swayAmplitude
        let cy = -10 + eased * (size.height * 0.72)

        // In quickly, out slowly: a spark that pops into existence reads as
        // an effect; one that fades in reads as noticed.
        let opacity = min(progress / 0.12, 1) * pow(1 - progress, 1.4) * 0.85

        let colour: Color =
            isGold
            ? Color(red: 0.94, green: 0.8, blue: 0.5)
            : .white
        let rect = CGRect(x: cx - size2, y: cy - size2, width: self.size, height: self.size)
        canvas.opacity = opacity
        canvas.fill(Circle().path(in: rect), with: .color(colour))
        // A faint halo doubles the spark's presence without doubling its size.
        canvas.opacity = opacity * 0.35
        canvas.fill(
            Circle().path(in: rect.insetBy(dx: -self.size * 0.8, dy: -self.size * 0.8)),
            with: .color(colour)
        )
    }

    private var size2: Double { size / 2 }
}
