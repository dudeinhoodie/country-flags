import Foundation

/// A consent decision. `unknown` is not `granted`: anything optional stays off
/// until somebody actually decided.
public enum ConsentStatus: String, Hashable, Sendable, CaseIterable {
    case unknown = "UNKNOWN"
    case granted = "GRANTED"
    case denied = "DENIED"
    case notRequired = "NOT_REQUIRED"

    public var allowsOptionalProcessing: Bool {
        self == .granted || self == .notRequired
    }
}

/// The App Tracking Transparency status as the OS reports it.
///
/// The app never asks for it: there is no tracking use case, no ad SDK and no
/// advertising identifier in the MVP. The value is modelled anyway because it
/// is a different question from consent and from placement eligibility, and
/// collapsing the three into one boolean is how apps end up tracking by
/// accident.
public enum TrackingAuthorization: String, Hashable, Sendable, CaseIterable {
    case notDetermined
    case denied
    case restricted
    case authorized
}

/// Everything outside the flags that can forbid an ad.
public struct AdvertisingPrivacyState: Hashable, Sendable {
    public let trackingAuthorization: TrackingAuthorization
    /// The regional decision about contextual advertising.
    public let advertisingConsent: ConsentStatus
    /// True while the audience question is open. Until the product decides,
    /// the app treats itself as child-directed and shows nothing.
    public let isChildDirectedTreatment: Bool
    /// Reserved for the future `ad_free` entitlement. It outranks every remote
    /// flag: a paid promise is not something a control plane may revoke.
    public let hasAdFreeEntitlement: Bool

    public init(
        trackingAuthorization: TrackingAuthorization = .notDetermined,
        advertisingConsent: ConsentStatus = .unknown,
        isChildDirectedTreatment: Bool = true,
        hasAdFreeEntitlement: Bool = false
    ) {
        self.trackingAuthorization = trackingAuthorization
        self.advertisingConsent = advertisingConsent
        self.isChildDirectedTreatment = isChildDirectedTreatment
        self.hasAdFreeEntitlement = hasAdFreeEntitlement
    }

    /// What the MVP runs with: nothing was asked, nothing was decided, so
    /// nothing is shown.
    public static let mvp = AdvertisingPrivacyState()
}

/// The server-evaluated advertising policy from `/v1/app-config`.
///
/// It is deliberately not persisted. A stale policy that outlived a launch
/// could switch advertising on for a device the backend has since excluded, and
/// the value is cheap to fetch again.
public struct AdvertisingPolicy: Hashable, Sendable {
    public enum Mode: String, Hashable, Sendable {
        case disabled = "DISABLED"
        case contextualOnly = "CONTEXTUAL_ONLY"
    }

    public struct PlacementPolicy: Hashable, Sendable {
        public let isEnabled: Bool
        public let format: AdFormat

        public init(isEnabled: Bool, format: AdFormat) {
            self.isEnabled = isEnabled
            self.format = format
        }
    }

    public let policyVersion: String
    public let isEnabled: Bool
    public let mode: Mode
    /// Keyed by placement key. A key the build does not know is dropped while
    /// decoding, so an unknown placement can never become eligible.
    public let placements: [AdPlacement: PlacementPolicy]
    public let refreshAfter: Date

    public init(
        policyVersion: String,
        isEnabled: Bool,
        mode: Mode,
        placements: [AdPlacement: PlacementPolicy],
        refreshAfter: Date
    ) {
        self.policyVersion = policyVersion
        self.isEnabled = isEnabled
        self.mode = mode
        self.placements = placements
        self.refreshAfter = refreshAfter
    }

    /// The policy in force until a snapshot says otherwise, including when the
    /// snapshot cannot be read.
    public static let disabled = AdvertisingPolicy(
        policyVersion: "bundled-default",
        isEnabled: false,
        mode: .disabled,
        placements: [:],
        refreshAfter: .distantPast
    )
}

/// Receives the advertising policy a configuration refresh produced.
public protocol AdvertisingPolicyReceiving: Sendable {
    func apply(_ policy: AdvertisingPolicy) async
}

/// Holds the policy currently in force.
///
/// It starts disabled and returns to disabled whenever the configuration cannot
/// be read, so "we do not know yet" and "advertising is off" are the same state
/// for every caller.
public actor AdvertisingPolicyStore: AdvertisingPolicyReceiving {
    public private(set) var policy: AdvertisingPolicy

    public init(policy: AdvertisingPolicy = .disabled) {
        self.policy = policy
    }

    public func apply(_ policy: AdvertisingPolicy) {
        self.policy = policy
    }

    public func current() -> AdvertisingPolicy {
        policy
    }
}

/// Whether an adapter exists and finished initializing.
///
/// The MVP ships `NoOpAdvertisingProvider`, which never becomes ready: an SDK
/// may not be initialized before eligibility has been proven, and there is no
/// SDK to initialize.
public enum AdProviderStatus: String, Hashable, Sendable, CaseIterable {
    case absent
    case initializing
    case ready
}

/// What the interface is doing right now.
///
/// Study, authentication, privacy, deletion and error screens are ad-free by
/// rule, so the state is an input to eligibility rather than a check each
/// screen has to remember.
public enum AdInterfaceState: String, Hashable, Sendable, CaseIterable {
    case idle
    case activeStudySession
    case authentication
    case privacyFlow
    case accountDeletion
    case errorScreen
    case onboardingBeforeFirstValue

    public var allowsAdvertising: Bool { self == .idle }
}
