import Foundation
import os

/// The flag values a study session was started with.
///
/// It is a plain value so a session can carry it into storage: a session that
/// survives a relaunch has to be resumed with the rules it began under, not
/// with whatever the backend says by then.
public struct SessionFeatureFlagSnapshot: Hashable, Sendable, Codable {
    public let capturedAt: Date
    public let configVersion: String?
    public let values: [String: FeatureFlagValue]

    public init(capturedAt: Date, configVersion: String?, values: [String: FeatureFlagValue]) {
        self.capturedAt = capturedAt
        self.configVersion = configVersion
        self.values = values
    }
}

/// Applies each flag's activation policy on top of the live values.
///
/// Without this layer a refresh landing mid-answer could change the mode of a
/// running session or rebuild the navigation under the person's finger. The
/// policy decides when a new value is allowed to be seen:
///
/// - `immediate` passes straight through, which is what makes a kill switch
///   worth having;
/// - `nextSession` is frozen for the life of a study session;
/// - `nextLaunch` is frozen for the life of the process.
public final class ActivatedFeatureFlags: FeatureFlagProviding {
    private let live: any FeatureFlagProviding
    private let dates: any DateProviding
    /// Captured once per run. Reading them later would defeat the policy, since
    /// by then a refresh may already have landed.
    private let launchValues: OSAllocatedUnfairLock<[String: FeatureFlagValue]?>
    private let session: OSAllocatedUnfairLock<SessionFeatureFlagSnapshot?>

    public init(live: any FeatureFlagProviding, dates: any DateProviding) {
        self.live = live
        self.dates = dates
        self.launchValues = OSAllocatedUnfairLock(initialState: nil)
        self.session = OSAllocatedUnfairLock(initialState: nil)
    }

    /// Freezes the launch-scoped flags.
    ///
    /// Called once the cached snapshot is in place, which is later than
    /// composition: capturing at init would freeze the bundled defaults and
    /// every `nextLaunch` flag would be stuck at them for the whole run.
    public func freezeLaunchValues() {
        let captured = Self.capture(policy: .nextLaunch, from: live)
        launchValues.withLock { $0 = captured }
    }

    /// Freezes the session-scoped flags. Called when a study session is
    /// created; the returned value belongs in the stored session.
    @discardableResult
    public func beginSession(configVersion: String? = nil) -> SessionFeatureFlagSnapshot {
        let snapshot = SessionFeatureFlagSnapshot(
            capturedAt: dates.now(),
            configVersion: configVersion,
            values: Self.capture(policy: .nextSession, from: live)
        )
        session.withLock { $0 = snapshot }
        return snapshot
    }

    /// Restores the flags a stored session was started with.
    public func resumeSession(_ snapshot: SessionFeatureFlagSnapshot) {
        session.withLock { $0 = snapshot }
    }

    public func endSession() {
        session.withLock { $0 = nil }
    }

    public var activeSession: SessionFeatureFlagSnapshot? {
        session.withLock { $0 }
    }

    public func boolValue(for key: BooleanFeatureFlag) -> Bool {
        guard case .boolean(let value) = activated(key) else {
            return key.defaultValue
        }
        return value
    }

    public func stringValue(for key: StringFeatureFlag) -> String {
        guard case .string(let value) = activated(key) else {
            return key.defaultValue
        }
        return value
    }

    public func numberValue(for key: NumberFeatureFlag) -> Double {
        guard case .number(let value) = activated(key) else {
            return key.defaultValue
        }
        return value
    }

    public func refresh(context: FeatureFlagContext) async {
        await live.refresh(context: context)
    }

    private func activated(_ key: some FeatureFlagKey) -> FeatureFlagValue {
        switch key.activationPolicy {
        case .immediate:
            return liveValue(of: key)
        case .nextLaunch:
            guard let frozen = launchValues.withLock({ $0 })?[key.rawValue] else {
                // Not frozen yet: the run has not finished starting, so the
                // live value is the one this launch will be pinned to anyway.
                return liveValue(of: key)
            }
            return frozen
        case .nextSession:
            guard let frozen = activeSession?.values[key.rawValue] else {
                // Between sessions the live value is the one a new session
                // would be created with, so there is nothing to freeze yet.
                return liveValue(of: key)
            }
            return frozen
        }
    }

    private func liveValue(of key: some FeatureFlagKey) -> FeatureFlagValue {
        Self.liveValue(of: key, from: live)
    }

    private static func liveValue(
        of key: some FeatureFlagKey,
        from provider: any FeatureFlagProviding
    ) -> FeatureFlagValue {
        switch key {
        case let key as BooleanFeatureFlag: .boolean(provider.boolValue(for: key))
        case let key as StringFeatureFlag: .string(provider.stringValue(for: key))
        case let key as NumberFeatureFlag: .number(provider.numberValue(for: key))
        default: key.definition.defaultValue
        }
    }

    private static func capture(
        policy: FeatureFlagActivationPolicy,
        from provider: any FeatureFlagProviding
    ) -> [String: FeatureFlagValue] {
        var captured: [String: FeatureFlagValue] = [:]
        for key in BooleanFeatureFlag.allCases where key.activationPolicy == policy {
            captured[key.rawValue] = .boolean(provider.boolValue(for: key))
        }
        for key in StringFeatureFlag.allCases where key.activationPolicy == policy {
            captured[key.rawValue] = .string(provider.stringValue(for: key))
        }
        for key in NumberFeatureFlag.allCases where key.activationPolicy == policy {
            captured[key.rawValue] = .number(provider.numberValue(for: key))
        }
        return captured
    }
}
