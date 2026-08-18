import SwiftUI

/// A pulse of light for a finished deck.
///
/// Not particles: one soft bloom of warm light behind the result and two
/// fine rings that widen out of it and dissolve — the register of a glass
/// raised once, drawn with keyframes so every phase eases the way a hand
/// would move. It plays once and leaves nothing running. Under reduced
/// motion nothing moves — the result's own arrival is the celebration.
struct CelebrationView: View {
    @State private var isRaised = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let gold = Color(red: 0.94, green: 0.82, blue: 0.55)

    var body: some View {
        if !reduceMotion {
            ZStack {
                bloom
                mainRing
                echoRing
            }
            .frame(width: 320, height: 320)
            .allowsHitTesting(false)
            .onAppear { isRaised = true }
        }
    }

    private var bloom: some View {
        RadialGradient(
            colors: [Self.gold.opacity(0.6), Self.gold.opacity(0.12), .clear],
            center: .center,
            startRadius: 0,
            endRadius: 150
        )
        .keyframeAnimator(initialValue: Pulse(), trigger: isRaised) { view, pulse in
            view
                .scaleEffect(pulse.bloomScale)
                .opacity(pulse.bloomOpacity)
        } keyframes: { _ in
            KeyframeTrack(\.bloomOpacity) {
                // In quickly enough to be felt, out slowly enough to be missed.
                CubicKeyframe(0.9, duration: 0.35)
                CubicKeyframe(0, duration: 1.6)
            }
            KeyframeTrack(\.bloomScale) {
                CubicKeyframe(1.05, duration: 0.5)
                CubicKeyframe(1.25, duration: 1.45)
            }
        }
    }

    private var ringStroke: LinearGradient {
        LinearGradient(
            colors: [.white.opacity(0.9), Self.gold],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    private var mainRing: some View {
        Circle()
            .strokeBorder(ringStroke, lineWidth: 1.5)
            .keyframeAnimator(initialValue: Pulse(), trigger: isRaised) { view, pulse in
                view
                    .scaleEffect(pulse.ringScale)
                    .opacity(pulse.ringOpacity)
            } keyframes: { _ in
                KeyframeTrack(\.ringScale) {
                    CubicKeyframe(1.45, duration: 1.7)
                }
                KeyframeTrack(\.ringOpacity) {
                    CubicKeyframe(0.5, duration: 0.25)
                    CubicKeyframe(0, duration: 1.45)
                }
            }
    }

    /// The echo starts later and travels less: a second, quieter word of the
    /// same sentence.
    private var echoRing: some View {
        Circle()
            .strokeBorder(ringStroke, lineWidth: 1)
            .keyframeAnimator(initialValue: Pulse(), trigger: isRaised) { view, pulse in
                view
                    .scaleEffect(pulse.echoScale)
                    .opacity(pulse.echoOpacity)
            } keyframes: { _ in
                KeyframeTrack(\.echoScale) {
                    CubicKeyframe(0.55, duration: 0.35)
                    CubicKeyframe(1.15, duration: 1.6)
                }
                KeyframeTrack(\.echoOpacity) {
                    CubicKeyframe(0, duration: 0.35)
                    CubicKeyframe(0.35, duration: 0.3)
                    CubicKeyframe(0, duration: 1.3)
                }
            }
    }

    private struct Pulse {
        var bloomOpacity = 0.0
        var bloomScale = 0.6
        var ringScale = 0.5
        var ringOpacity = 0.0
        var echoScale = 0.55
        var echoOpacity = 0.0
    }
}
