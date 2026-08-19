import Foundation

/// The consent category an event belongs to.
///
/// The distinction is the whole of the privacy model: operational events keep
/// the service working and are collected as part of running it, while product
/// analytics is optional and is not collected at all unless it was allowed.
public enum AnalyticsConsentCategory: String, Hashable, Sendable, CaseIterable {
    case productAnalytics = "product_analytics"
    case essentialOperations = "essential_operations"
}

/// Every event this client may send, and nothing else.
///
/// The names are the canonical registry's — `contracts/registries/analytics-events.json`
/// — and a parity test holds the two together. A free-form name cannot be
/// expressed here at all, which is the point: an event nobody declared cannot
/// be measured, and an event assembled at a call site is how personal data ends
/// up in a funnel.
public enum AnalyticsEventName: String, Hashable, Sendable, CaseIterable {
    case onboardingCompleted = "onboarding.completed"
    case deckOpened = "deck.opened"
    case studySessionStarted = "study.session_started"
    case studySessionCompleted = "study.session_completed"
    case studySessionAbandoned = "study.session_abandoned"
    case achievementEarned = "achievement.earned"
    case featureExposed = "feature.exposed"
    case authCompleted = "auth.completed"
    case syncCompleted = "sync.completed"
    case contentUpdateCompleted = "content.update_completed"

    public var consentCategory: AnalyticsConsentCategory {
        switch self {
        case .syncCompleted, .contentUpdateCompleted: .essentialOperations
        default: .productAnalytics
        }
    }

    /// Whether collection stops when consent is withheld. Operational events
    /// are required: without them a failing sync is invisible to the people
    /// who have to fix it.
    public var isOptional: Bool { consentCategory == .productAnalytics }

    /// The registry versions each event independently; every one of them is at
    /// version 1 today, and the parity test is what keeps this honest.
    public var schemaVersion: Int { 1 }
}

/// The value types a property may hold, matching the batch schema's own list.
///
/// It encodes as the bare JSON value rather than as a tagged object: the
/// backend checks each property against the registry's declared type, so an
/// integer has to arrive as `10` and not as `"10"` or `{"integer": 10}`.
public enum AnalyticsValue: Hashable, Sendable, Codable {
    case string(String)
    case number(Double)
    case integer(Int)
    case boolean(Bool)

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        // Bool first: `true` also decodes as a number on some platforms, and
        // an integer check before it would turn a flag into 1.
        if let value = try? container.decode(Bool.self) {
            self = .boolean(value)
        } else if let value = try? container.decode(Int.self) {
            self = .integer(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else {
            self = .string(try container.decode(String.self))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .integer(let value): try container.encode(value)
        case .boolean(let value): try container.encode(value)
        }
    }
}

// MARK: - The enumerated property values

/// Each of these mirrors an `enumValues` list in the registry. They exist so a
/// call site cannot pass a string the backend will reject — or, worse, one it
/// will accept and nobody can group by.
public enum AnalyticsAuthState: String, Hashable, Sendable, CaseIterable {
    case guest
    case authenticated
}

public enum AnalyticsDeckType: String, Hashable, Sendable, CaseIterable {
    case system
    case dynamic
    case custom
}

public enum AnalyticsStudyMode: String, Hashable, Sendable, CaseIterable {
    case selfRated = "self_rated"
    case multipleChoice = "multiple_choice"
}

/// How long a session took, as a bucket. The exact duration stays on the
/// device: the product question is "short, medium or long", and a precise
/// number is one more thing that can identify somebody.
public enum AnalyticsSessionDurationBucket: String, Hashable, Sendable, CaseIterable {
    case underOneMinute = "under_60s"
    case oneToThreeMinutes = "60_180s"
    case overThreeMinutes = "over_180s"

    public init(seconds: TimeInterval) {
        switch seconds {
        case ..<60: self = .underOneMinute
        case ..<180: self = .oneToThreeMinutes
        default: self = .overThreeMinutes
        }
    }
}

public enum AnalyticsCorrectRateBucket: String, Hashable, Sendable, CaseIterable {
    case belowHalf = "0_49"
    case fair = "50_79"
    case good = "80_89"
    case excellent = "90_100"

    /// - Parameters:
    ///   - correct: answers graded as remembered.
    ///   - total: answers given.
    ///
    /// A session with no answers reports the lowest bucket rather than dividing
    /// by zero; it is also a session that never reaches the completed event.
    public init(correct: Int, total: Int) {
        guard total > 0 else {
            self = .belowHalf
            return
        }
        let percent = Double(correct) / Double(total) * 100
        switch percent {
        case ..<50: self = .belowHalf
        case ..<80: self = .fair
        case ..<90: self = .good
        default: self = .excellent
        }
    }
}

public enum AnalyticsProgressBucket: String, Hashable, Sendable, CaseIterable {
    case barelyStarted = "0_24"
    case quarter = "25_49"
    case half = "50_74"
    case almostDone = "75_99"

    public init(answered: Int, planned: Int) {
        guard planned > 0 else {
            self = .barelyStarted
            return
        }
        let percent = Double(answered) / Double(planned) * 100
        switch percent {
        case ..<25: self = .barelyStarted
        case ..<50: self = .quarter
        case ..<75: self = .half
        default: self = .almostDone
        }
    }
}

public enum AnalyticsAchievementCategory: String, Hashable, Sendable, CaseIterable {
    case mastery
    case consistency
    case objective
}

public enum AnalyticsAchievementTier: String, Hashable, Sendable, CaseIterable {
    case bronze
    case silver
    case gold
    case platinum
}

public enum AnalyticsAuthResult: String, Hashable, Sendable, CaseIterable {
    case success
    case cancelled
    case failed
}

public enum AnalyticsSyncResult: String, Hashable, Sendable, CaseIterable {
    case success
    case partial
    case failed
}

public enum AnalyticsSyncDurationBucket: String, Hashable, Sendable, CaseIterable {
    case underOneSecond = "under_1s"
    case oneToFiveSeconds = "1_5s"
    case overFiveSeconds = "over_5s"

    public init(seconds: TimeInterval) {
        switch seconds {
        case ..<1: self = .underOneSecond
        case ..<5: self = .oneToFiveSeconds
        default: self = .overFiveSeconds
        }
    }
}

public enum AnalyticsContentUpdateResult: String, Hashable, Sendable, CaseIterable {
    case success
    case failed
}

// MARK: - The event itself

/// One event, built only through the factories below.
///
/// The initialiser is private on purpose: a public one would accept any name
/// with any properties, and the registry would become documentation rather
/// than a rule. Everything the app is allowed to measure is a function on this
/// type, so an unregistered event or a misspelled property is a compile error.
public struct AnalyticsEvent: Hashable, Sendable {
    public let name: AnalyticsEventName
    public let properties: [String: AnalyticsValue]
    public let occurredAt: Date

    private init(
        name: AnalyticsEventName,
        properties: [String: AnalyticsValue],
        occurredAt: Date
    ) {
        self.name = name
        self.properties = properties
        self.occurredAt = occurredAt
    }

    public var isOptional: Bool { name.isOptional }
    public var schemaVersion: Int { name.schemaVersion }

    public static func onboardingCompleted(
        authState: AnalyticsAuthState,
        at instant: Date
    ) -> Self {
        Self(
            name: .onboardingCompleted,
            properties: ["authState": .string(authState.rawValue)],
            occurredAt: instant
        )
    }

    public static func deckOpened(deckType: AnalyticsDeckType, at instant: Date) -> Self {
        Self(
            name: .deckOpened,
            properties: ["deckType": .string(deckType.rawValue)],
            occurredAt: instant
        )
    }

    public static func studySessionStarted(
        mode: AnalyticsStudyMode,
        requestedCardCount: Int,
        at instant: Date
    ) -> Self {
        Self(
            name: .studySessionStarted,
            properties: [
                "mode": .string(mode.rawValue),
                "requestedCardCount": .integer(requestedCardCount),
            ],
            occurredAt: instant
        )
    }

    public static func studySessionCompleted(
        mode: AnalyticsStudyMode,
        deckType: AnalyticsDeckType,
        requestedCardCount: Int,
        uniqueCardCount: Int,
        reviewCount: Int,
        duration: AnalyticsSessionDurationBucket,
        correctRate: AnalyticsCorrectRateBucket,
        at instant: Date
    ) -> Self {
        Self(
            name: .studySessionCompleted,
            properties: [
                "mode": .string(mode.rawValue),
                "deckType": .string(deckType.rawValue),
                "requestedCardCount": .integer(requestedCardCount),
                "uniqueCardCount": .integer(uniqueCardCount),
                "reviewCount": .integer(reviewCount),
                "durationBucket": .string(duration.rawValue),
                "correctRateBucket": .string(correctRate.rawValue),
            ],
            occurredAt: instant
        )
    }

    public static func studySessionAbandoned(
        mode: AnalyticsStudyMode,
        progress: AnalyticsProgressBucket,
        at instant: Date
    ) -> Self {
        Self(
            name: .studySessionAbandoned,
            properties: [
                "mode": .string(mode.rawValue),
                "progressBucket": .string(progress.rawValue),
            ],
            occurredAt: instant
        )
    }

    /// The tier is optional in the registry: not every achievement has one.
    public static func achievementEarned(
        category: AnalyticsAchievementCategory,
        tier: AnalyticsAchievementTier?,
        at instant: Date
    ) -> Self {
        var properties: [String: AnalyticsValue] = ["category": .string(category.rawValue)]
        if let tier {
            properties["tier"] = .string(tier.rawValue)
        }
        return Self(name: .achievementEarned, properties: properties, occurredAt: instant)
    }

    /// Reported when a flagged feature is actually shown, not when its flag is
    /// read — see `FeatureExposureRecorder`.
    public static func featureExposed(
        flagKey: String,
        variant: String,
        experimentId: String,
        surface: String,
        at instant: Date
    ) -> Self {
        Self(
            name: .featureExposed,
            properties: [
                "flagKey": .string(flagKey),
                "variant": .string(variant),
                "experimentId": .string(experimentId),
                "surface": .string(surface),
            ],
            occurredAt: instant
        )
    }

    /// The provider and the outcome, never the identity behind either.
    public static func authCompleted(
        provider: AuthProvider,
        result: AnalyticsAuthResult,
        at instant: Date
    ) -> Self {
        Self(
            name: .authCompleted,
            properties: [
                "provider": .string(provider.rawValue.lowercased()),
                "result": .string(result.rawValue),
            ],
            occurredAt: instant
        )
    }

    public static func syncCompleted(
        result: AnalyticsSyncResult,
        duration: AnalyticsSyncDurationBucket,
        at instant: Date
    ) -> Self {
        Self(
            name: .syncCompleted,
            properties: [
                "result": .string(result.rawValue),
                "durationBucket": .string(duration.rawValue),
            ],
            occurredAt: instant
        )
    }

    public static func contentUpdateCompleted(
        result: AnalyticsContentUpdateResult,
        at instant: Date
    ) -> Self {
        Self(
            name: .contentUpdateCompleted,
            properties: ["result": .string(result.rawValue)],
            occurredAt: instant
        )
    }
}
