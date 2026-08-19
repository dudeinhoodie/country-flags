import Foundation

/// What the account has said about a category of collection.
///
/// The raw values are the contract's. `unknown` is not a quiet yes: it means
/// nobody has been asked yet, and until they are, optional collection does not
/// happen. `notRequired` is the regional answer — consent is not needed there —
/// and it permits collection without one.
public enum ConsentStatus: String, Hashable, Sendable, CaseIterable {
    case unknown = "UNKNOWN"
    case granted = "GRANTED"
    case denied = "DENIED"
    case notRequired = "NOT_REQUIRED"

    /// Whether this status permits optional collection.
    public var permitsOptionalCollection: Bool {
        switch self {
        case .granted, .notRequired: true
        case .unknown, .denied: false
        }
    }
}

/// The consent the device is acting under.
///
/// Held as a value rather than read from a store at each call: a decision made
/// halfway through building a batch would be a decision applied to some events
/// and not others.
public struct TelemetryConsent: Hashable, Sendable {
    public let productAnalytics: ConsentStatus
    public let diagnostics: ConsentStatus
    public let policyVersion: String
    /// The server's version, for the optimistic concurrency the settings
    /// endpoint requires. A device that has never synced starts at 1.
    public let version: Int
    public let updatedAt: Date

    public init(
        productAnalytics: ConsentStatus,
        diagnostics: ConsentStatus,
        policyVersion: String,
        version: Int,
        updatedAt: Date
    ) {
        self.productAnalytics = productAnalytics
        self.diagnostics = diagnostics
        self.policyVersion = policyVersion
        self.version = version
        self.updatedAt = updatedAt
    }

    /// Nobody has been asked yet, so nothing optional is collected. This is the
    /// state a fresh install is in, and it is deliberately the quiet one.
    public static func unasked(policyVersion: String, now: Date) -> Self {
        Self(
            productAnalytics: .unknown,
            diagnostics: .unknown,
            policyVersion: policyVersion,
            version: 1,
            updatedAt: now
        )
    }

    /// Whether an event of this category may be collected at all.
    ///
    /// Operational events are not a consent question: they are how a broken
    /// sync becomes visible to the people who have to fix it, and they carry
    /// an outcome and a duration bucket rather than anything about a person.
    public func allows(_ category: AnalyticsConsentCategory) -> Bool {
        switch category {
        case .essentialOperations: true
        case .productAnalytics: productAnalytics.permitsOptionalCollection
        }
    }

    public func allows(_ event: AnalyticsEvent) -> Bool {
        allows(event.name.consentCategory)
    }

    /// Whether a crash or MetricKit report may leave the device.
    public var allowsDiagnostics: Bool { diagnostics.permitsOptionalCollection }
}

/// The opaque identity events are attributed to.
///
/// Not an email, not a provider subject, not the account identifier: an
/// analytics backend has no use for any of those, and holding one makes every
/// later deletion request harder. The anonymous identifier survives sign-in so
/// a funnel is not cut in half; it is regenerated on sign-out and on account
/// deletion, which is what "clears the identified context" means in practice.
public struct TelemetryContext: Hashable, Sendable {
    public let anonymousID: String
    public let sessionID: String
    public let platform: String
    public let appVersion: String
    public let build: String
    public let locale: String
    public let featureConfigVersion: String?

    public init(
        anonymousID: String,
        sessionID: String,
        platform: String = "ios",
        appVersion: String,
        build: String,
        locale: String,
        featureConfigVersion: String? = nil
    ) {
        self.anonymousID = anonymousID
        self.sessionID = sessionID
        self.platform = platform
        self.appVersion = appVersion
        self.build = build
        self.locale = locale
        self.featureConfigVersion = featureConfigVersion
    }
}

/// Where the anonymous identifier lives between launches, and how it is retired.
///
/// It is a device preference rather than a secret — it identifies nobody on its
/// own — but it must be rotatable, because signing out has to end the trail
/// that was being attributed to the person who left.
public protocol TelemetryIdentityStoring: Sendable {
    func anonymousID() -> String?
    func store(anonymousID: String)
    func clearAnonymousID()
}

/// Removes what must never leave the device.
///
/// The typed registry means product events cannot carry free text at all, so
/// this exists for the two payloads that are not typed: diagnostic reports and
/// error contexts. It is a denylist applied before export, and it is the first
/// line rather than the only one — the backend scrubs again.
public enum TelemetryRedaction {
    /// What a redacted run of characters is replaced with. Fixed, so a test can
    /// assert on it and so the shape of what was removed is not itself a hint.
    public static let placeholder = "[redacted]"

    private static let patterns: [String] = [
        // Bearer tokens and anything that looks like a JWT.
        "(?i)bearer\\s+[A-Za-z0-9._~+/=-]{8,}",
        "eyJ[A-Za-z0-9._-]{10,}",
        // Email addresses.
        "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}",
        // Authorization-ish headers quoted into a message.
        "(?i)(authorization|cookie|set-cookie)\\s*[:=]\\s*\\S+",
        // Long opaque runs: refresh tokens, keychain blobs, hex digests.
        "[A-Fa-f0-9]{32,}",
        "[A-Za-z0-9_-]{40,}",
    ]

    /// Scrubs a string that is about to be exported.
    ///
    /// - Parameter limit: the most characters that may survive. A payload that
    ///   is too long is truncated rather than dropped: the first part of a
    ///   stack trace is the useful part, and an unbounded one is how a whole
    ///   response body ends up in a report.
    public static func scrub(_ text: String, limit: Int = 2048) -> String {
        var scrubbed = text
        for pattern in patterns {
            guard let expression = try? NSRegularExpression(pattern: pattern) else { continue }
            scrubbed = expression.stringByReplacingMatches(
                in: scrubbed,
                range: NSRange(scrubbed.startIndex..., in: scrubbed),
                withTemplate: placeholder
            )
        }
        guard scrubbed.count > limit else { return scrubbed }
        return String(scrubbed.prefix(limit)) + "…"
    }

    /// Whether a string still contains something that must not be exported.
    /// Used by the tests that plant canary secrets, and cheap enough to assert
    /// with before an upload.
    public static func containsForbiddenText(_ text: String) -> Bool {
        patterns.contains { pattern in
            guard let expression = try? NSRegularExpression(pattern: pattern) else { return false }
            let range = NSRange(text.startIndex..., in: text)
            return expression.firstMatch(in: text, range: range) != nil
        }
    }
}
