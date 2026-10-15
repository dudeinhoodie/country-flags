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
    /// What the backend's version policy asks of this build (#447). The root
    /// stops at the update screen when it is `required`.
    public private(set) var updateRequirement: ClientUpdateRequirement = .none

    @ObservationIgnored
    private let flags: any FeatureFlagProviding
    @ObservationIgnored
    private let versionPolicy: (any ClientVersionPolicyProviding)?
    @ObservationIgnored
    private let appVersion: String

    /// - Parameters:
    ///   - versionPolicy: where the backend's version policy is read. Nil
    ///     asks nothing of the build, which is what previews and tests that
    ///     are not about updates want.
    ///   - appVersion: this build's `CFBundleShortVersionString`.
    public init(
        flags: any FeatureFlagProviding,
        versionPolicy: (any ClientVersionPolicyProviding)? = nil,
        appVersion: String = "0.0.0"
    ) {
        self.flags = flags
        self.versionPolicy = versionPolicy
        self.appVersion = appVersion
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
        evaluateVersionPolicy()
    }

    /// Reads the version policy of the snapshot now answering.
    ///
    /// Called once the cached snapshot is in place, before the network is
    /// asked, and again after every refresh. The cached answer counts: a
    /// build the backend has already refused stays refused on a launch with
    /// no network, rather than opening for as long as the request takes to
    /// time out.
    public func evaluateVersionPolicy() {
        updateRequirement =
            versionPolicy?.clientVersionPolicy?.requirement(forAppVersion: appVersion) ?? .none
    }
}
