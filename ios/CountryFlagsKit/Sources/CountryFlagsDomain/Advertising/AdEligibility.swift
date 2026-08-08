import Foundation

/// What the OS reports about cross-app tracking.
///
/// The MVP never asks: contextual ads do not need it, and a prompt shown "just
/// in case" is both a policy risk and a worse first launch. The state is
/// modelled anyway so a later decision has somewhere to live, and so that it
/// stays distinct from consent — the two answer different questions.
public enum AdTrackingAuthorization: String, Hashable, Sendable {
    case notDetermined
    case restricted
    case denied
    case authorized
}

public enum ConsentDecision: String, Hashable, Sendable {
    case unknown
    case notRequired
    case granted
    case denied
}

/// The privacy inputs of an advertising decision, kept apart on purpose.
///
/// Collapsing them into one boolean is how an app ends up showing personalized
/// ads to somebody who only agreed to analytics.
public struct AdvertisingPrivacyState: Hashable, Sendable {
    public let trackingAuthorization: AdTrackingAuthorization
    /// The regional consent decision, when the region needs one.
    public let regionalConsent: ConsentDecision
    /// Whether the user allowed personalized advertising specifically.
    public let personalizationConsent: ConsentDecision

    public init(
        trackingAuthorization: AdTrackingAuthorization = .notDetermined,
        regionalConsent: ConsentDecision = .unknown,
        personalizationConsent: ConsentDecision = .unknown
    ) {
        self.trackingAuthorization = trackingAuthorization
        self.regionalConsent = regionalConsent
        self.personalizationConsent = personalizationConsent
    }

    /// No provider, no tracking, nothing asked. The MVP state.
    public static let none = AdvertisingPrivacyState()
}

public enum AdProviderState: String, Hashable, Sendable {
    /// No provider is linked at all, which is the MVP.
    case absent
    case initializing
    case ready
    case failed
}

public enum AdFreeEntitlement: String, Hashable, Sendable {
    case unknown
    case active
    case absent
}

/// The local UX guard rails. They are not a security boundary; they keep the
/// app from interrupting a person who is in the middle of something.
public struct AdFrequencyState: Hashable, Sendable {
    public let capReached: Bool
    public let completedSessions: Int
    public let minimumCompletedSessions: Int

    public init(capReached: Bool, completedSessions: Int, minimumCompletedSessions: Int) {
        self.capReached = capReached
        self.completedSessions = completedSessions
        self.minimumCompletedSessions = minimumCompletedSessions
    }

    public static let untouched = AdFrequencyState(
        capReached: false,
        completedSessions: 0,
        minimumCompletedSessions: 3
    )
}

/// Whether the screen underneath can host an ad right now.
public enum AdSurfaceState: String, Hashable, Sendable {
    case safe
    /// A card being answered, an auth or privacy flow, an error screen, account
    /// deletion. The advertising spec forbids every one of them.
    case forbidden
}

public struct AdEligibilityInput: Hashable, Sendable {
    public let placement: AdPlacement
    /// The global kill switch, `ads.enabled`.
    public let globallyEnabled: Bool
    /// The flag of this placement.
    public let placementFlagEnabled: Bool
    /// Absent when no snapshot has been accepted yet.
    public let policy: AdvertisingPolicy?
    public let providerState: AdProviderState
    public let privacy: AdvertisingPrivacyState
    public let entitlement: AdFreeEntitlement
    public let frequency: AdFrequencyState
    public let surface: AdSurfaceState

    public init(
        placement: AdPlacement,
        globallyEnabled: Bool,
        placementFlagEnabled: Bool,
        policy: AdvertisingPolicy?,
        providerState: AdProviderState,
        privacy: AdvertisingPrivacyState,
        entitlement: AdFreeEntitlement,
        frequency: AdFrequencyState,
        surface: AdSurfaceState
    ) {
        self.placement = placement
        self.globallyEnabled = globallyEnabled
        self.placementFlagEnabled = placementFlagEnabled
        self.policy = policy
        self.providerState = providerState
        self.privacy = privacy
        self.entitlement = entitlement
        self.frequency = frequency
        self.surface = surface
    }
}

public enum AdBlockReason: String, Hashable, Sendable {
    case globallyDisabled
    case placementDisabled
    case policyUnknown
    case policyDisallows
    case providerUnavailable
    case privacyNotSatisfied
    case adFreeEntitlement
    case frequencyCapReached
    case forbiddenSurface
}

public enum AdEligibility: Hashable, Sendable {
    case eligible
    case blocked(AdBlockReason)

    public var isEligible: Bool {
        self == .eligible
    }
}

/// The single place that decides whether an ad may be shown.
///
/// Every condition of the advertising spec is checked here rather than at each
/// call site, and anything unknown blocks: the cost of a missing ad is nothing,
/// the cost of one shown where policy forbids it is the account.
public struct AdEligibilityService: Sendable {
    public init() {}

    public func evaluate(_ input: AdEligibilityInput) -> AdEligibility {
        guard input.globallyEnabled else { return .blocked(.globallyDisabled) }
        guard input.placementFlagEnabled else { return .blocked(.placementDisabled) }

        guard let policy = input.policy else { return .blocked(.policyUnknown) }
        guard policy.enabled, policy.mode != .disabled else { return .blocked(.policyDisallows) }
        guard let placementPolicy = policy.policy(for: input.placement),
            placementPolicy.enabled,
            placementPolicy.format == input.placement.format
        else {
            return .blocked(.policyDisallows)
        }

        guard input.providerState == .ready else { return .blocked(.providerUnavailable) }

        switch input.entitlement {
        case .active: return .blocked(.adFreeEntitlement)
        case .unknown: return .blocked(.adFreeEntitlement)
        case .absent: break
        }

        guard isPrivacySatisfied(mode: policy.mode, privacy: input.privacy) else {
            return .blocked(.privacyNotSatisfied)
        }

        guard !input.frequency.capReached,
            input.frequency.completedSessions >= input.frequency.minimumCompletedSessions
        else {
            return .blocked(.frequencyCapReached)
        }

        guard input.surface == .safe else { return .blocked(.forbiddenSurface) }

        return .eligible
    }

    /// Contextual ads need a region that either asks for no consent or was
    /// given it. They do not need App Tracking Transparency, which is exactly
    /// why the mode exists.
    private func isPrivacySatisfied(
        mode: AdvertisingMode,
        privacy: AdvertisingPrivacyState
    ) -> Bool {
        switch mode {
        case .disabled:
            return false
        case .contextualOnly:
            return privacy.regionalConsent == .granted || privacy.regionalConsent == .notRequired
        }
    }
}
