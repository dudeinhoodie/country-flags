import Foundation

/// A generator that produces the same sequence for the same seed.
///
/// SplitMix64: pure arithmetic, no platform dependence, so a session replayed
/// in a test — or reconstructed from a support report — shuffles exactly the
/// way it shuffled on the device. The system generator is for the app; this
/// one is for anything that must be repeatable.
public struct SeededRandomNumberGenerator: RandomNumberGenerator, Sendable {
    private var state: UInt64

    public init(seed: UInt64) {
        state = seed
    }

    public mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var mixed = state
        mixed = (mixed ^ (mixed >> 30)) &* 0xBF58_476D_1CE4_E5B9
        mixed = (mixed ^ (mixed >> 27)) &* 0x94D0_49BB_1331_11EB
        return mixed ^ (mixed >> 31)
    }
}
