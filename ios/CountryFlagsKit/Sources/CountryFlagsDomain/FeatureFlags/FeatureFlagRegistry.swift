import Foundation

/// When a new value is allowed to take effect.
public enum FeatureFlagActivationPolicy: String, Hashable, Sendable, CaseIterable {
    /// Applied while the app runs. Reserved for switching something off.
    case immediate
    /// Fixed when a study session is created and kept until it ends, so a
    /// refresh cannot change the mode or the deck of a session in progress.
    case nextSession
    /// Applied on the next cold launch. Used for navigation and composition.
    case nextLaunch
}

public enum FeatureFlagCategory: String, Hashable, Sendable {
    case release
    case operational
    case experiment
    case remoteConfiguration = "remote_configuration"
}

public enum FeatureFlagValueType: String, Hashable, Sendable {
    case boolean
    case string
    case number
}

/// A value a flag can hold. The contract allows these three types only.
public enum FeatureFlagValue: Hashable, Sendable {
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

/// What this build knows about one flag.
///
/// The definition is the client half of the shared registry in
/// `contracts/registries/feature-flags.json`: the key, the type and the default
/// have to agree with the backend, and a `FeatureFlagRegistryTests` case fails
/// when they drift apart.
public struct FeatureFlagDefinition: Hashable, Sendable {
    public let key: String
    public let defaultValue: FeatureFlagValue
    public let category: FeatureFlagCategory
    public let activationPolicy: FeatureFlagActivationPolicy
    public let owner: String
    /// The values a string flag may take. A remote variant outside the list is
    /// one this build cannot render, so it is refused rather than displayed.
    public let allowedValues: [String]?
    /// The range a number flag may take, for the same reason.
    public let bounds: ClosedRange<Double>?

    public init(
        key: String,
        defaultValue: FeatureFlagValue,
        category: FeatureFlagCategory,
        activationPolicy: FeatureFlagActivationPolicy,
        owner: String,
        allowedValues: [String]? = nil,
        bounds: ClosedRange<Double>? = nil
    ) {
        self.key = key
        self.defaultValue = defaultValue
        self.category = category
        self.activationPolicy = activationPolicy
        self.owner = owner
        self.allowedValues = allowedValues
        self.bounds = bounds
    }

    public var type: FeatureFlagValueType {
        defaultValue.type
    }

    /// Whether a remotely evaluated value may replace the bundled default.
    ///
    /// A snapshot is produced by a service this build does not control, so a
    /// value of the wrong type or outside the agreed set is treated as absent.
    /// Refusing it costs a feature that stays at its default; accepting it
    /// costs a screen that cannot render what it was handed.
    public func accepts(_ value: FeatureFlagValue) -> Bool {
        switch (value, defaultValue) {
        case (.boolean, .boolean):
            return true
        case (.string(let candidate), .string):
            guard let allowedValues else { return true }
            return allowedValues.contains(candidate)
        case (.number(let candidate), .number):
            guard candidate.isFinite else { return false }
            guard let bounds else { return true }
            return bounds.contains(candidate)
        default:
            return false
        }
    }
}

/// A typed flag key.
///
/// Feature code names a case instead of a string, so a renamed or removed flag
/// is a compile error rather than a silent default at runtime.
public protocol FeatureFlagKey: RawRepresentable, CaseIterable, Hashable, Sendable
where RawValue == String {
    var definition: FeatureFlagDefinition { get }
}

extension FeatureFlagKey {
    public var key: String { rawValue }
    public var activationPolicy: FeatureFlagActivationPolicy { definition.activationPolicy }
}

public enum BooleanFeatureFlag: String, FeatureFlagKey {
    case studyMultipleChoiceEnabled = "study.multiple_choice.enabled"
    case studyReviewSubmissionEnabled = "study.review_submission.enabled"
    case adsEnabled = "ads.enabled"
    case adsHomeBottomBannerEnabled = "ads.home.bottom_banner.enabled"
    case adsCatalogInlineNativeEnabled = "ads.catalog.inline_native.enabled"
    case adsSessionResultInterstitialEnabled = "ads.session_result.interstitial.enabled"
    case adsRewardedOptionalBonusEnabled = "ads.rewarded.optional_bonus.enabled"
    case monetizationPaidDecksStorefrontEnabled = "monetization.paid_decks.storefront_enabled"
    case commerceAppleIapEnabled = "commerce.apple_iap.enabled"
    case commercePaidDecksDiscoveryEnabled = "commerce.paid_decks.discovery.enabled"
    case commerceDeckEuropeCoatsEnabled = "commerce.deck.europe_coats.enabled"
    case commerceDeckUsStateFlagsEnabled = "commerce.deck.us_state_flags.enabled"
    case contentCoatsOfArmsEnabled = "content.coats_of_arms.enabled"
    case contentSubdivisionsEnabled = "content.subdivisions.enabled"

    /// Available without any I/O, which is what lets the first screen render
    /// before the network answers.
    public var defaultValue: Bool {
        switch self {
        // Not released yet.
        case .studyMultipleChoiceEnabled: false
        // A write path: the safe default is the one that keeps working.
        case .studyReviewSubmissionEnabled: true
        // Advertising is off in the MVP, and every placement defaults to off
        // independently of the global switch.
        case .adsEnabled, .adsHomeBottomBannerEnabled, .adsCatalogInlineNativeEnabled,
            .adsSessionResultInterstitialEnabled, .adsRewardedOptionalBonusEnabled:
            false
        // The storefront and everything it shows are off until the rollout
        // gate opens. None of these decides who owns a deck: an owner keeps
        // full access with every one of them false, and a non-owner is told
        // purchasing is unavailable rather than handed the deck (ADR-019).
        case .monetizationPaidDecksStorefrontEnabled, .commerceAppleIapEnabled,
            .commercePaidDecksDiscoveryEnabled, .commerceDeckEuropeCoatsEnabled,
            .commerceDeckUsStateFlagsEnabled, .contentCoatsOfArmsEnabled,
            .contentSubdivisionsEnabled:
            false
        }
    }

    public var definition: FeatureFlagDefinition {
        FeatureFlagDefinition(
            key: rawValue,
            defaultValue: .boolean(defaultValue),
            category: category,
            activationPolicy: activationPolicy,
            owner: owner
        )
    }

    private var category: FeatureFlagCategory {
        switch self {
        case .studyMultipleChoiceEnabled, .adsHomeBottomBannerEnabled,
            .adsCatalogInlineNativeEnabled, .adsSessionResultInterstitialEnabled,
            .adsRewardedOptionalBonusEnabled,
            .monetizationPaidDecksStorefrontEnabled, .commerceAppleIapEnabled,
            .commercePaidDecksDiscoveryEnabled, .commerceDeckEuropeCoatsEnabled,
            .commerceDeckUsStateFlagsEnabled, .contentCoatsOfArmsEnabled,
            .contentSubdivisionsEnabled:
            .release
        case .studyReviewSubmissionEnabled, .adsEnabled:
            .operational
        }
    }

    public var activationPolicy: FeatureFlagActivationPolicy {
        switch self {
        // The session mode may not change halfway through a session, and
        // neither does what a session is made of: turning coats of arms or
        // subdivisions on mid-session would change the cards under the
        // learner.
        case .studyMultipleChoiceEnabled, .contentCoatsOfArmsEnabled,
            .contentSubdivisionsEnabled:
            .nextSession
        // Everything else here is a switch that has to work at once.
        default: .immediate
        }
    }

    private var owner: String {
        switch self {
        case .studyMultipleChoiceEnabled, .studyReviewSubmissionEnabled: "learning"
        case .contentCoatsOfArmsEnabled, .contentSubdivisionsEnabled: "content"
        default: "monetization"
        }
    }
}

public enum StringFeatureFlag: String, FeatureFlagKey {
    case homeRecommendedDecksVariant = "home.recommended_decks.variant"

    public var defaultValue: String {
        switch self {
        // The control variant of the experiment.
        case .homeRecommendedDecksVariant: "control"
        }
    }

    public var definition: FeatureFlagDefinition {
        switch self {
        case .homeRecommendedDecksVariant:
            FeatureFlagDefinition(
                key: rawValue,
                defaultValue: .string(defaultValue),
                category: .experiment,
                activationPolicy: .nextLaunch,
                owner: "discovery",
                allowedValues: ["control", "personalized"]
            )
        }
    }
}

public enum NumberFeatureFlag: String, FeatureFlagKey {
    case studyMaxNewCardsPerSession = "study.max_new_cards_per_session"

    public var defaultValue: Double {
        switch self {
        case .studyMaxNewCardsPerSession: 10
        }
    }

    public var definition: FeatureFlagDefinition {
        switch self {
        case .studyMaxNewCardsPerSession:
            FeatureFlagDefinition(
                key: rawValue,
                defaultValue: .number(defaultValue),
                category: .remoteConfiguration,
                activationPolicy: .nextSession,
                owner: "learning",
                bounds: 0...20
            )
        }
    }
}

/// Every flag this build knows.
public enum FeatureFlagRegistry {
    public static let definitions: [FeatureFlagDefinition] =
        BooleanFeatureFlag.allCases.map(\.definition)
        + StringFeatureFlag.allCases.map(\.definition)
        + NumberFeatureFlag.allCases.map(\.definition)

    private static let byKey: [String: FeatureFlagDefinition] = Dictionary(
        definitions.map { ($0.key, $0) },
        uniquingKeysWith: { first, _ in first }
    )

    /// A key the backend sent and this build does not know returns nil; the
    /// caller drops the entry instead of storing an unusable value.
    public static func definition(forKey key: String) -> FeatureFlagDefinition? {
        byKey[key]
    }
}
