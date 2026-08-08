import Foundation

public enum LogLevel: String, Hashable, Sendable, CaseIterable {
    case debug
    case info
    case notice
    case error
    case fault
}

/// The subsystems that log. A fixed list keeps a console filter useful and
/// stops a new module from inventing a category nobody reads.
public enum LogCategory: String, Hashable, Sendable, CaseIterable {
    case network
    case auth
    case sync
    case persistence
    case study
    case content
    case featureFlags
    case analytics
}

/// A value attached to a log entry.
///
/// The distinction is the point: a caller has to decide, at the call site,
/// whether something may be read back off a device. There is no default that
/// quietly prints whatever it was given.
public enum LogValue: Hashable, Sendable {
    /// An error code, a version, an operation name: safe by construction.
    case safe(String)
    /// Masked before it is written anywhere.
    case sensitive(String)
    case count(Int)
}

public struct LogEntry: Hashable, Sendable {
    public let level: LogLevel
    public let category: LogCategory
    /// A constant sentence. Interpolating a value here is what leaks it, so
    /// values belong in `metadata`.
    public let message: String
    public let metadata: [String: LogValue]

    public init(
        level: LogLevel,
        category: LogCategory,
        message: String,
        metadata: [String: LogValue] = [:]
    ) {
        self.level = level
        self.category = category
        self.message = message
        self.metadata = metadata
    }
}

public protocol AppLogging: Sendable {
    func log(_ entry: LogEntry)
}

extension AppLogging {
    public func log(
        _ level: LogLevel,
        _ category: LogCategory,
        _ message: String,
        _ metadata: [String: LogValue] = [:]
    ) {
        log(LogEntry(level: level, category: category, message: message, metadata: metadata))
    }
}

public struct NoOpLogger: AppLogging {
    public init() {}

    public func log(_ entry: LogEntry) {}
}

/// Removes what must never be written down.
///
/// The `sensitive` channel already covers values a caller declared. This pass
/// is the second line: a message assembled from an error description, a URL or
/// a decoded body can carry a token nobody meant to log, and the device is not
/// the place to find that out.
public enum LogRedaction {
    public static let mask = "[redacted]"

    /// Ordered so the more specific pattern runs first.
    private static let patterns: [NSRegularExpression] = {
        let sources = [
            // Authorization headers and bearer tokens.
            #"(?i)bearer\s+[A-Za-z0-9\-._~+/]+=*"#,
            // JSON Web Tokens, which identity providers hand out.
            #"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"#,
            // token=, secret=, password=, code=, refresh_token=…
            #"(?i)\b(?:access_?token|refresh_?token|id_?token|token|secret|password|passwd|api_?key|authorization)\b\s*[=:]\s*\"?[^\s\",;&]+"#,
            // Email addresses.
            #"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"#,
            // A URL query string, which carries locales and cursors and is not
            // worth the risk of also carrying an identity payload. The pattern
            // needs a `key=value` after the separator so an ordinary question
            // mark in a sentence is left alone.
            #"\?[A-Za-z0-9_\-%\[\]]+=[^\s]*"#,
        ]
        return sources.compactMap { try? NSRegularExpression(pattern: $0) }
    }()

    public static func redact(_ text: String) -> String {
        patterns.reduce(text) { current, pattern in
            pattern.stringByReplacingMatches(
                in: current,
                range: NSRange(current.startIndex..., in: current),
                withTemplate: mask
            )
        }
    }

    /// The line a non-OSLog sink writes. Deterministic, so a test can assert
    /// what a device would have recorded.
    public static func render(_ entry: LogEntry) -> String {
        let rendered =
            entry.metadata
            .sorted { $0.key < $1.key }
            .map { "\($0.key)=\(value($0.value))" }
            .joined(separator: " ")
        let message = redact(entry.message)
        return rendered.isEmpty
            ? "[\(entry.category.rawValue)] \(message)"
            : "[\(entry.category.rawValue)] \(message) \(rendered)"
    }

    private static func value(_ value: LogValue) -> String {
        switch value {
        case .safe(let text): redact(text)
        case .sensitive: mask
        case .count(let count): String(count)
        }
    }
}
