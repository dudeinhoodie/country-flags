import Foundation
import os

@testable import CountryFlagsDomain

/// A flag source a test drives directly.
final class StubFeatureFlags: FeatureFlagProviding, @unchecked Sendable {
    private let values = OSAllocatedUnfairLock<[String: FeatureFlagValue]>(initialState: [:])
    private let refreshes = OSAllocatedUnfairLock<[FeatureFlagContext]>(initialState: [])

    func set(_ value: FeatureFlagValue, for key: some FeatureFlagKey) {
        values.withLock { $0[key.rawValue] = value }
    }

    var refreshedContexts: [FeatureFlagContext] {
        refreshes.withLock { $0 }
    }

    func boolValue(for key: BooleanFeatureFlag) -> Bool {
        guard case .boolean(let value) = values.withLock({ $0[key.rawValue] }) else {
            return key.defaultValue
        }
        return value
    }

    func stringValue(for key: StringFeatureFlag) -> String {
        guard case .string(let value) = values.withLock({ $0[key.rawValue] }) else {
            return key.defaultValue
        }
        return value
    }

    func numberValue(for key: NumberFeatureFlag) -> Double {
        guard case .number(let value) = values.withLock({ $0[key.rawValue] }) else {
            return key.defaultValue
        }
        return value
    }

    func refresh(context: FeatureFlagContext) async {
        refreshes.withLock { $0.append(context) }
    }
}

/// Records what would have been sent instead of sending it.
final class RecordingAnalyticsTracker: AnalyticsTracking, @unchecked Sendable {
    private let state = OSAllocatedUnfairLock<[AnalyticsEvent]>(initialState: [])

    var events: [AnalyticsEvent] {
        state.withLock { $0 }
    }

    func track(_ event: AnalyticsEvent) async {
        state.withLock { $0.append(event) }
    }

    func setIdentity(_ identity: AnalyticsIdentity?) async {}
    func flush() async {}
}

struct FixedDateProvider: DateProviding {
    let instant: Date

    func now() -> Date {
        instant
    }
}
