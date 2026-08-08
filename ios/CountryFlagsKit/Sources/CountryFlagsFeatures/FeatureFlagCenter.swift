import Foundation
import Observation

import CountryFlagsDomain

/// What views read flags through.
///
/// SwiftUI needs a change to observe; the flag client is a value source that
/// answers synchronously and has no opinion about redrawing. This type is the
/// join: a completed refresh bumps `revision`, every view that read a flag while
/// rendering depends on it, and the ones that did not are left alone.
///
/// It deliberately does not decide *whether* a new value applies — the
/// activation policy already did that, so a refresh that changes only
/// session-scoped flags redraws nothing.
@MainActor
@Observable
public final class FeatureFlagCenter {
    /// Increments once per completed refresh.
    public private(set) var revision: Int = 0
    public private(set) var context: FeatureFlagContext?

    @ObservationIgnored
    private let flags: any FeatureFlagProviding

    public init(flags: any FeatureFlagProviding) {
        self.flags = flags
    }

    public func isEnabled(_ key: BooleanFeatureFlag) -> Bool {
        _ = revision
        return flags.boolValue(for: key)
    }

    public func variant(of key: StringFeatureFlag) -> String {
        _ = revision
        return flags.stringValue(for: key)
    }

    public func number(of key: NumberFeatureFlag) -> Double {
        _ = revision
        return flags.numberValue(for: key)
    }

    /// Fetches a snapshot for the context and publishes the result.
    public func refresh(context: FeatureFlagContext) async {
        await flags.refresh(context: context)
        self.context = context
        revision += 1
    }
}
