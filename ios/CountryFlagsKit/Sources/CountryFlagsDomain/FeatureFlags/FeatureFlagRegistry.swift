import Foundation

/// Why a flag exists.
///
/// The category decides how long a flag may live: a release flag is removed
/// once the feature is everywhere, while an operational kill switch stays.
public enum FeatureFlagCategory: String, Hashable, Sendable, CaseIterable {
    case release
    case operational
    case experiment
    case remoteConfiguration = "remote_configuration"
}

/// When a new value is allowed to take effect.
public enum FeatureFlagActivationPolicy: String, Hashable, Sendable, Codable, CaseIterable {
    /// Applied while the app runs. Reserved for switching off something that
    /// can be interrupted safely.
    case immediate
    /// Frozen when a study session is created, so a session never changes its
    /// mode, its cards or its interface halfway through.
    case nextSession
    /// Applied on the next launch. Reserved for navigation, persistence and
    /// composition changes that cannot be rebuilt under the user's hands.
    case nextLaunch
}

public enum FeatureFlagValueType: String, Hashable, Sendable, CaseIterable {
    case boolean
    case string
    case number
}

/// One resolved flag value.
public enum FeatureFlagValue: Hashable, Sendable, Codable {
    case boolean(Bool)
    case string(String)
    case number(Double)

    public var type: FeatureFlagValueType {
        switch self {
        case .boolean: .boolean
        case .string: .string
        case .number: .number
        }
    }
}

/// A registry entry without its Swift type, used to compare the typed keys
/// below against the canonical registry in `contracts/registries`.
public struct FeatureFlagDefinition: Hashable, Sendable {
    public let key: String
    public let type: FeatureFlagValueType
    public let defaultValue: FeatureFlagValue
    public let category: FeatureFlagCategory
    public let activationPolicy: FeatureFlagActivationPolicy
    public let owner: String

    public init(
        key: String,
        type: FeatureFlagValueType,
        defaultValue: FeatureFlagValue,
        category: FeatureFlagCategory,
        activationPolicy: FeatureFlagActivationPolicy,
        owner: String
    ) {
        self.key = key
        self.type = type
        self.defaultValue = defaultValue
        self.category = category
        self.activationPolicy = activationPolicy
        self.owner = owner
    }
}

/// The shape every typed flag key has.
///
/// Feature code names a case of one of the three enums below instead of a
/// string, so a typo cannot silently evaluate a flag that does not exist and a
/// key cannot be read with the wrong type.
public protocol FeatureFlagKey: Hashable, Sendable {
    associatedtype Value: Hashable & Sendable

    var key: String { get }
    /// Shipped with the binary and available before any network call.
    var defaultValue: Value { get }
    var category: FeatureFlagCategory { get }
    var activationPolicy: FeatureFlagActivationPolicy { get }
    var owner: String { get }
    /// Rejects a remote value the registry does not allow, which is how an
    /// out-of-range number or an unknown variant falls back to the default.
    func accepts(_ value: Value) -> Bool
}

public enum BooleanFeatureFlag: String, FeatureFlagKey, CaseIterable {
    case studyMultipleChoiceEnabled = "study.multiple_choice.enabled"
    case studyReviewSubmissionEnabled = "study.review_submission.enabled"
    case adsEnabled = "ads.enabled"
    case adsHomeBottomBannerEnabled = "ads.home.bottom_banner.enabled"
    case adsCatalogInlineNativeEnabled = "ads.catalog.inline_native.enabled"
    case adsSessionResultInterstitialEnabled = "ads.session_result.interstitial.enabled"
    case adsRewardedOptionalBonusEnabled = "ads.rewarded.optional_bonus.enabled"

    public var key: String { rawValue }

    public var defaultValue: Bool {
        switch self {
        // An operational write path defaults to the value that keeps the app
        // working; everything else is either unreleased or advertising, and
        // both default to off.
        case .studyReviewSubmissionEnabled: true
        default: false
        }
    }

    public var category: FeatureFlagCategory {
        switch self {
        case .studyMultipleChoiceEnabled: .release
        case .studyReviewSubmissionEnabled, .adsEnabled: .operational
        default: .release
        }
    }

    public var activationPolicy: FeatureFlagActivationPolicy {
        switch self {
        case .studyMultipleChoiceEnabled: .nextSession
        // Every advertising flag is a kill switch, so it applies at once.
        default: .immediate
        }
    }

    public var owner: String {
        switch self {
        case .studyMultipleChoiceEnabled, .studyReviewSubmissionEnabled: "learning"
        default: "monetization"
        }
    }

    public func accepts(_ value: Bool) -> Bool { true }
}

public enum StringFeatureFlag: String, FeatureFlagKey, CaseIterable {
    case homeRecommendedDecksVariant = "home.recommended_decks.variant"

    public var key: String { rawValue }

    public var defaultValue: String {
        switch self {
        // The control variant of the experiment.
        case .homeRecommendedDecksVariant: "control"
        }
    }

    /// A variant the build does not know how to render is not applied.
    public var allowedValues: Set<String> {
        switch self {
        case .homeRecommendedDecksVariant: ["control", "personalized"]
        }
    }

    public var category: FeatureFlagCategory {
        switch self {
        case .homeRecommendedDecksVariant: .experiment
        }
    }

    public var activationPolicy: FeatureFlagActivationPolicy {
        switch self {
        case .homeRecommendedDecksVariant: .nextLaunch
        }
    }

    public var owner: String {
        switch self {
        case .homeRecommendedDecksVariant: "discovery"
        }
    }

    public func accepts(_ value: String) -> Bool {
        allowedValues.contains(value)
    }
}

public enum NumberFeatureFlag: String, FeatureFlagKey, CaseIterable {
    case studyMaxNewCardsPerSession = "study.max_new_cards_per_session"

    public var key: String { rawValue }

    public var defaultValue: Double {
        switch self {
        case .studyMaxNewCardsPerSession: 10
        }
    }

    /// The bundled bounds. A value outside them is treated as invalid rather
    /// than clamped: silently halving a remote limit would hide a mistake in
    /// the control plane.
    public var allowedRange: ClosedRange<Double> {
        switch self {
        case .studyMaxNewCardsPerSession: 0...20
        }
    }

    public var category: FeatureFlagCategory {
        switch self {
        case .studyMaxNewCardsPerSession: .remoteConfiguration
        }
    }

    public var activationPolicy: FeatureFlagActivationPolicy {
        switch self {
        case .studyMaxNewCardsPerSession: .nextSession
        }
    }

    public var owner: String {
        switch self {
        case .studyMaxNewCardsPerSession: "learning"
        }
    }

    public func accepts(_ value: Double) -> Bool {
        value.isFinite && allowedRange.contains(value)
    }
}

/// Everything the client knows about flags, in one place.
///
/// The canonical list lives in `contracts/registries/feature-flags.json`; the
/// tests compare these definitions against a mirror of it so the client and the
/// backend cannot drift on a key, a type or a default.
public enum FeatureFlagRegistry {
    public static let definitions: [FeatureFlagDefinition] =
        BooleanFeatureFlag.allCases.map { flag in
            FeatureFlagDefinition(
                key: flag.key,
                type: .boolean,
                defaultValue: .boolean(flag.defaultValue),
                category: flag.category,
                activationPolicy: flag.activationPolicy,
                owner: flag.owner
            )
        }
        + StringFeatureFlag.allCases.map { flag in
            FeatureFlagDefinition(
                key: flag.key,
                type: .string,
                defaultValue: .string(flag.defaultValue),
                category: flag.category,
                activationPolicy: flag.activationPolicy,
                owner: flag.owner
            )
        }
        + NumberFeatureFlag.allCases.map { flag in
            FeatureFlagDefinition(
                key: flag.key,
                type: .number,
                defaultValue: .number(flag.defaultValue),
                category: flag.category,
                activationPolicy: flag.activationPolicy,
                owner: flag.owner
            )
        }

    public static func definition(forKey key: String) -> FeatureFlagDefinition? {
        definitions.first { $0.key == key }
    }

    /// The bundled values, available synchronously before any snapshot exists.
    public static var bundledDefaults: [String: FeatureFlagValue] {
        Dictionary(uniqueKeysWithValues: definitions.map { ($0.key, $0.defaultValue) })
    }
}
