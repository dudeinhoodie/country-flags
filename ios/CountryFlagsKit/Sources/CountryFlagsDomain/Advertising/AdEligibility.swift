import Foundation

/// Why an ad was not shown. Every reason is a value the diagnostics can report
/// without saying anything about the person.
public enum AdDenialReason: String, Hashable, Sendable, CaseIterable {
    case globallyDisabled
    case placementFlagDisabled
    case placementNotInPolicy
    case placementNotApproved
    case formatMismatch
    case surfaceNotAllowed
    case providerUnavailable
    case consentMissing
    case childDirectedAudience
    case adFreeEntitlement
    case frequencyCapReached
    case unsafeInterfaceState
}

public enum AdEligibility: Hashable, Sendable {
    case allowed
    case denied(AdDenialReason)

    public var isAllowed: Bool {
        if case .allowed = self { return true }
        return false
    }

    public var denialReason: AdDenialReason? {
        if case .denied(let reason) = self { return reason }
        return nil
    }
}

/// The local limits. They are not a security boundary; they keep the app from
/// becoming unpleasant if advertising is ever switched on.
public struct AdFrequencyCapPolicy: Hashable, Sendable {
    public let minimumCompletedStudySessions: Int
    public let minimumIntervalBetweenInterstitials: TimeInterval
    public let maximumPresentationsPerPlacementPerAppSession: Int
    public let maximumPresentationsPerDay: Int
    public let cooldownAfterDismissOrFailure: TimeInterval

    public init(
        minimumCompletedStudySessions: Int,
        minimumIntervalBetweenInterstitials: TimeInterval,
        maximumPresentationsPerPlacementPerAppSession: Int,
        maximumPresentationsPerDay: Int,
        cooldownAfterDismissOrFailure: TimeInterval
    ) {
        self.minimumCompletedStudySessions = minimumCompletedStudySessions
        self.minimumIntervalBetweenInterstitials = minimumIntervalBetweenInterstitials
        self.maximumPresentationsPerPlacementPerAppSession = maximumPresentationsPerPlacementPerAppSession
        self.maximumPresentationsPerDay = maximumPresentationsPerDay
        self.cooldownAfterDismissOrFailure = cooldownAfterDismissOrFailure
    }

    /// Deliberately strict. Numbers that are actually shown to people are a
    /// product decision taken before advertising is switched on.
    public static let bundled = AdFrequencyCapPolicy(
        minimumCompletedStudySessions: 3,
        minimumIntervalBetweenInterstitials: 15 * 60,
        maximumPresentationsPerPlacementPerAppSession: 1,
        maximumPresentationsPerDay: 3,
        cooldownAfterDismissOrFailure: 5 * 60
    )
}

/// What has happened so far, as the caps need to see it.
public struct AdFrequencyState: Hashable, Sendable {
    public let completedStudySessions: Int
    public let presentationsOfPlacementThisAppSession: Int
    public let presentationsToday: Int
    public let lastInterstitialAt: Date?
    public let lastDismissOrFailureAt: Date?

    public init(
        completedStudySessions: Int = 0,
        presentationsOfPlacementThisAppSession: Int = 0,
        presentationsToday: Int = 0,
        lastInterstitialAt: Date? = nil,
        lastDismissOrFailureAt: Date? = nil
    ) {
        self.completedStudySessions = completedStudySessions
        self.presentationsOfPlacementThisAppSession = presentationsOfPlacementThisAppSession
        self.presentationsToday = presentationsToday
        self.lastInterstitialAt = lastInterstitialAt
        self.lastDismissOrFailureAt = lastDismissOrFailureAt
    }
}

/// One question put to the eligibility rules.
public struct AdEligibilityRequest: Sendable {
    public let placement: AdPlacement
    public let surface: AdSurface
    public let policy: AdvertisingPolicy
    public let privacy: AdvertisingPrivacyState
    public let providerStatus: AdProviderStatus
    public let interface: AdInterfaceState
    public let frequency: AdFrequencyState
    public let caps: AdFrequencyCapPolicy
    /// What product and privacy review have cleared. Empty in the shipping app.
    public let approvedPlacements: Set<AdPlacement>
    public let now: Date

    public init(
        placement: AdPlacement,
        surface: AdSurface,
        policy: AdvertisingPolicy = .disabled,
        privacy: AdvertisingPrivacyState = .mvp,
        providerStatus: AdProviderStatus = .absent,
        interface: AdInterfaceState = .idle,
        frequency: AdFrequencyState = AdFrequencyState(),
        caps: AdFrequencyCapPolicy = .bundled,
        approvedPlacements: Set<AdPlacement> = AdPlacementRegistry.approvedForRelease,
        now: Date
    ) {
        self.placement = placement
        self.surface = surface
        self.policy = policy
        self.privacy = privacy
        self.providerStatus = providerStatus
        self.interface = interface
        self.frequency = frequency
        self.caps = caps
        self.approvedPlacements = approvedPlacements
        self.now = now
    }
}

/// The single place that decides whether an ad may appear.
///
/// Every condition has to hold at once and anything unknown denies, so a screen
/// cannot arrive at "probably fine" on its own. Privacy, audience policy and
/// the future entitlement are checked before the flags, because a flag is not a
/// consent mechanism and must never be able to override one.
public struct AdEligibilityService: Sendable {
    private let flags: any FeatureFlagProviding

    public init(flags: any FeatureFlagProviding) {
        self.flags = flags
    }

    public func decide(_ request: AdEligibilityRequest) -> AdEligibility {
        if request.privacy.hasAdFreeEntitlement {
            return .denied(.adFreeEntitlement)
        }
        if request.privacy.isChildDirectedTreatment {
            return .denied(.childDirectedAudience)
        }
        if !request.privacy.advertisingConsent.allowsOptionalProcessing {
            return .denied(.consentMissing)
        }
        if !request.interface.allowsAdvertising {
            return .denied(.unsafeInterfaceState)
        }
        if !request.approvedPlacements.contains(request.placement) {
            return .denied(.placementNotApproved)
        }
        if !request.placement.allowedSurfaces.contains(request.surface) {
            return .denied(.surfaceNotAllowed)
        }
        if !flags.boolValue(for: .adsEnabled) {
            return .denied(.globallyDisabled)
        }
        if !flags.boolValue(for: request.placement.featureFlag) {
            return .denied(.placementFlagDisabled)
        }
        guard request.policy.isEnabled, request.policy.mode != .disabled else {
            return .denied(.globallyDisabled)
        }
        guard let placementPolicy = request.policy.placements[request.placement] else {
            return .denied(.placementNotInPolicy)
        }
        guard placementPolicy.isEnabled else {
            return .denied(.placementFlagDisabled)
        }
        // A policy that renamed the format of a placement is a mismatch between
        // the backend and this build; guessing which one is right would present
        // a format the build never approved.
        guard placementPolicy.format == request.placement.format else {
            return .denied(.formatMismatch)
        }
        guard request.providerStatus == .ready else {
            return .denied(.providerUnavailable)
        }
        return frequencyDecision(request)
    }

    private func frequencyDecision(_ request: AdEligibilityRequest) -> AdEligibility {
        let caps = request.caps
        let frequency = request.frequency

        if frequency.completedStudySessions < caps.minimumCompletedStudySessions {
            return .denied(.frequencyCapReached)
        }
        if frequency.presentationsOfPlacementThisAppSession
            >= caps.maximumPresentationsPerPlacementPerAppSession
        {
            return .denied(.frequencyCapReached)
        }
        if frequency.presentationsToday >= caps.maximumPresentationsPerDay {
            return .denied(.frequencyCapReached)
        }
        if let lastFailure = frequency.lastDismissOrFailureAt,
            request.now.timeIntervalSince(lastFailure) < caps.cooldownAfterDismissOrFailure
        {
            return .denied(.frequencyCapReached)
        }
        if request.placement.format == .interstitial,
            let lastInterstitial = frequency.lastInterstitialAt,
            request.now.timeIntervalSince(lastInterstitial) < caps.minimumIntervalBetweenInterstitials
        {
            return .denied(.frequencyCapReached)
        }
        return .allowed
    }
}
