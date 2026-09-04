import SwiftUI

/// Whether this device wants to be tapped back.
///
/// The preference is a switch in the settings, it syncs with the account, and
/// until now nothing read it: every `sensoryFeedback` in the app fired
/// regardless, so the switch stored a wish nobody granted. It travels through
/// the environment rather than through four initialisers because feedback is
/// ambient — a screen deep in a session should not have to be handed the
/// preference to know it.
///
/// True by default, which is what an unconfigured preview or a screen outside
/// the app's shell gets: the app has always buzzed, and the absence of an
/// answer is not a refusal.
private struct HapticsEnabledKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    public var hapticsEnabled: Bool {
        get { self[HapticsEnabledKey.self] }
        set { self[HapticsEnabledKey.self] = newValue }
    }
}

extension View {
    /// `sensoryFeedback`, unless this device asked not to be tapped.
    ///
    /// A wrapper rather than a rule everybody remembers: the check is one
    /// `&&` at every call site, and one call site forgetting it is a switch
    /// that half works, which is worse than one that does not exist.
    func hapticFeedback<T: Equatable>(
        _ feedback: SensoryFeedback,
        trigger: T
    ) -> some View {
        modifier(HapticFeedbackModifier(feedback: feedback, trigger: trigger, when: { _, _ in true }))
    }

    /// The same, for the call sites that only want the tap on some changes.
    func hapticFeedback<T: Equatable>(
        _ feedback: SensoryFeedback,
        trigger: T,
        condition: @escaping (T, T) -> Bool
    ) -> some View {
        modifier(HapticFeedbackModifier(feedback: feedback, trigger: trigger, when: condition))
    }
}

private struct HapticFeedbackModifier<T: Equatable>: ViewModifier {
    let feedback: SensoryFeedback
    let trigger: T
    let when: (T, T) -> Bool

    @Environment(\.hapticsEnabled) private var hapticsEnabled

    func body(content: Content) -> some View {
        content.sensoryFeedback(feedback, trigger: trigger) { old, new in
            hapticsEnabled && when(old, new)
        }
    }
}
