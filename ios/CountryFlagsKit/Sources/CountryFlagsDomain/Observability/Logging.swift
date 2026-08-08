import Foundation

/// The subsystems a log line can belong to. A closed list keeps the categories
/// usable as a filter in Console and stops a free-form string from becoming one.
public enum LogCategory: String, Hashable, Sendable, CaseIterable {
    case network
    case auth
    case sync
    case persistence
    case study
    case content
    case featureFlags
    case analytics
    case advertising
}

public enum LogLevel: Int, Hashable, Sendable, CaseIterable, Comparable {
    case debug
    case info
    case notice
    case error
    case fault

    public static func < (lhs: LogLevel, rhs: LogLevel) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

/// One structured log line.
///
/// There is no field for a message the caller composed, so a log line cannot
/// carry an interpolated answer, URL or body. `event` is a constant written in
/// the code, and every field passes through `Redaction` in this initializer, so
/// no implementation of `AppLogging` can receive an unredacted value.
public struct LogEvent: Hashable, Sendable {
    public let category: LogCategory
    public let level: LogLevel
    /// A stable identifier such as `snapshot.refresh_failed`.
    public let event: String
    /// The identifier the backend echoes, which is what a support request is
    /// looked up by. It is a UUID and carries nothing personal.
    public let requestID: String?
    public let fields: [String: String]

    public init(
        category: LogCategory,
        level: LogLevel,
        event: String,
        requestID: String? = nil,
        fields: [String: String] = [:]
    ) {
        self.category = category
        self.level = level
        self.event = event
        self.requestID = requestID
        self.fields = Redaction.redact(fields: fields)
    }

    /// The fields rendered in a stable order, which is what an adapter writes
    /// and what a test can assert on.
    public var renderedFields: String {
        fields
            .sorted { $0.key < $1.key }
            .map { "\($0.key)=\($0.value)" }
            .joined(separator: " ")
    }
}

public protocol AppLogging: Sendable {
    func log(_ event: LogEvent)
}

extension AppLogging {
    public func log(
        _ level: LogLevel,
        _ event: String,
        category: LogCategory,
        requestID: String? = nil,
        fields: [String: String] = [:]
    ) {
        log(
            LogEvent(
                category: category,
                level: level,
                event: event,
                requestID: requestID,
                fields: fields
            )
        )
    }
}

public struct NoOpAppLogger: AppLogging {
    public init() {}

    public func log(_ event: LogEvent) {}
}
