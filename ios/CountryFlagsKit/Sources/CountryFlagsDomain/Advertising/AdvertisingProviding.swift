import Foundation

/// What a provider adapter is told before it may do anything.
///
/// It carries no account scope, no user identifier and no device identifier: an
/// ad provider has no business learning who is studying.
public struct AdvertisingContext: Hashable, Sendable {
    public let policyVersion: String
    public let mode: AdvertisingPolicy.Mode
    public let locale: String
    /// Personalization is impossible while this is true, and it is true until a
    /// product decision says otherwise.
    public let isChildDirectedTreatment: Bool

    public init(
        policyVersion: String,
        mode: AdvertisingPolicy.Mode,
        locale: String,
        isChildDirectedTreatment: Bool
    ) {
        self.policyVersion = policyVersion
        self.mode = mode
        self.locale = locale
        self.isChildDirectedTreatment = isChildDirectedTreatment
    }
}

public enum AdLoadResult: Hashable, Sendable {
    /// No adapter is integrated. Not a user-visible failure.
    case unavailable
    case noFill
    /// A registered provider code, never an SDK message.
    case failed(code: String)
    case ready
}

public enum AdPresentationResult: Hashable, Sendable {
    case notPresented
    case dismissed
    case failed(code: String)
}

/// The screen an adapter would present from.
///
/// It exposes only its surface, so the presenting side stays checkable against
/// the placement registry and no view controller leaks into the domain.
@MainActor
public protocol AdPresentationHost: AnyObject {
    var surface: AdSurface { get }
}

/// The whole advertising surface of the app.
///
/// A view or a view model depends on this protocol and never on an ad SDK, so
/// choosing a network later is a change in one adapter rather than in every
/// screen.
public protocol AdvertisingProviding: Sendable {
    func prepare(context: AdvertisingContext) async
    func load(_ placement: AdPlacement) async -> AdLoadResult
    @MainActor
    func present(
        _ placement: AdPlacement,
        from host: AdPresentationHost
    ) async -> AdPresentationResult
    /// Called on sign-out, on consent withdrawal and on an account switch.
    func reset() async
}

/// The production default.
///
/// It initializes nothing, requests nothing and presents nothing. That is the
/// entire advertising behaviour of the MVP: the boundary exists so a network
/// can be added later behind an ADR and a privacy review, and until then no
/// third-party code runs and no identifier is collected.
public struct NoOpAdvertisingProvider: AdvertisingProviding {
    public init() {}

    public func prepare(context: AdvertisingContext) async {}

    public func load(_ placement: AdPlacement) async -> AdLoadResult { .unavailable }

    @MainActor
    public func present(
        _ placement: AdPlacement,
        from host: AdPresentationHost
    ) async -> AdPresentationResult {
        .notPresented
    }

    public func reset() async {}
}
