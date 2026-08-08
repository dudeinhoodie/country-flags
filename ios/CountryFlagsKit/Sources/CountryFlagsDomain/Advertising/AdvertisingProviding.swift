import Foundation

public struct AdvertisingContext: Hashable, Sendable {
    public let scope: AccountScope
    public let policy: AdvertisingPolicy
    public let privacy: AdvertisingPrivacyState

    public init(
        scope: AccountScope,
        policy: AdvertisingPolicy,
        privacy: AdvertisingPrivacyState
    ) {
        self.scope = scope
        self.policy = policy
        self.privacy = privacy
    }
}

public enum AdLoadResult: Hashable, Sendable {
    case ready
    /// The provider answered and had nothing to show. An expected outcome, not
    /// an error the user hears about.
    case noFill
    /// No provider, or one that failed. Also not a user-facing error.
    case unavailable
}

public enum AdPresentationResult: Hashable, Sendable {
    case notPresented
    case dismissed
    case rewardEarned
}

/// Whatever a provider would present from.
///
/// It stays opaque so the domain does not import UIKit and so no view controller
/// reaches a layer that has no business holding one.
@MainActor
public protocol AdPresentationHost: AnyObject {}

/// The advertising boundary.
///
/// It exists so that choosing a provider later is a composition change. No
/// view or view model may import an ad SDK; they see this protocol only.
public protocol AdvertisingProviding: Sendable {
    func prepare(context: AdvertisingContext) async
    func load(_ placement: AdPlacement) async -> AdLoadResult
    @MainActor
    func present(
        _ placement: AdPlacement,
        from host: any AdPresentationHost
    ) async -> AdPresentationResult
    /// Called on sign-out, on a withdrawn consent and on an account switch, so
    /// no provider state survives the person it belonged to.
    func reset() async
}

/// The production default.
///
/// Advertising is switched off for the MVP, so the shipping app links no ad
/// SDK at all: this type initializes nothing, requests nothing and returns the
/// same answers offline as online.
public struct NoOpAdvertisingProvider: AdvertisingProviding {
    public init() {}

    public func prepare(context: AdvertisingContext) async {}

    public func load(_ placement: AdPlacement) async -> AdLoadResult {
        .unavailable
    }

    @MainActor
    public func present(
        _ placement: AdPlacement,
        from host: any AdPresentationHost
    ) async -> AdPresentationResult {
        .notPresented
    }

    public func reset() async {}
}

/// What a screen should reserve for a placement.
///
/// A hidden slot occupies nothing. A banner frame left behind "for later" is a
/// blank rectangle in every build that has no provider, and it pushes the
/// content the person actually came for off the screen.
public struct AdSlot: Hashable, Sendable {
    public let placement: AdPlacement
    public let isVisible: Bool
    /// Points to reserve. Zero unless something is really going to be drawn.
    public let reservedHeight: Double

    public init(placement: AdPlacement, eligibility: AdEligibility, loadedHeight: Double) {
        self.placement = placement
        self.isVisible = eligibility.isEligible && loadedHeight > 0
        self.reservedHeight = isVisible ? loadedHeight : 0
    }

    public static func hidden(_ placement: AdPlacement) -> AdSlot {
        AdSlot(placement: placement, eligibility: .blocked(.providerUnavailable), loadedHeight: 0)
    }
}
