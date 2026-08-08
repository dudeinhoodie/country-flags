import Foundation
import OSLog

import CountryFlagsDomain

/// Writes structured entries to the unified log.
///
/// Only values that are safe by construction are interpolated as `public`: the
/// category, the level, the event identifier and the request identifier. Field
/// values stay `private` even though `LogEvent` has already redacted them,
/// because the redaction and the log privacy level protect against different
/// mistakes — one against a value nobody expected to be a secret, the other
/// against a device log being read off the machine.
///
/// A release build stops below `.notice`, so debug tracing never ships.
public struct OSLogAppLogger: AppLogging {
    private let subsystem: String
    private let minimumLevel: LogLevel

    public init(subsystem: String = "app.countryflags", minimumLevel: LogLevel = .info) {
        self.subsystem = subsystem
        self.minimumLevel = minimumLevel
    }

    /// The level a build that is not for development should keep.
    public static let releaseMinimumLevel: LogLevel = .notice

    public func log(_ event: LogEvent) {
        guard event.level >= minimumLevel else { return }
        let logger = Logger(subsystem: subsystem, category: event.category.rawValue)
        let fields = event.renderedFields

        logger.log(
            level: Self.osLogType(for: event.level),
            """
            \(event.event, privacy: .public) \
            requestID=\(event.requestID ?? "-", privacy: .public) \
            \(fields, privacy: .private)
            """
        )
    }

    private static func osLogType(for level: LogLevel) -> OSLogType {
        switch level {
        case .debug: .debug
        case .info: .info
        case .notice: .default
        case .error: .error
        case .fault: .fault
        }
    }
}
