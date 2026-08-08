import Foundation
import OSLog
import os

import CountryFlagsDomain

/// The default logger.
///
/// Values arrive already classified: a `safe` value is interpolated as public
/// because the call site vouched for it, a `sensitive` one is hashed so repeat
/// occurrences can still be correlated without the value being readable, and
/// the message itself is scrubbed on the way in. Nothing here can be handed a
/// token or an address and print it.
public struct OSLogAppLogger: AppLogging {
    private let subsystem: String

    public init(subsystem: String = "app.countryflags") {
        self.subsystem = subsystem
    }

    public func log(_ entry: LogEntry) {
        let logger = Logger(subsystem: subsystem, category: entry.category.rawValue)
        let message = LogRedaction.redact(entry.message)
        let metadata = entry.metadata.sorted { $0.key < $1.key }

        logger.log(level: Self.osLogType(for: entry.level), "\(message, privacy: .public)")
        for (key, value) in metadata {
            switch value {
            case .safe(let text):
                logger.log(
                    level: Self.osLogType(for: entry.level),
                    "\(key, privacy: .public)=\(LogRedaction.redact(text), privacy: .public)"
                )
            case .sensitive(let text):
                logger.log(
                    level: Self.osLogType(for: entry.level),
                    "\(key, privacy: .public)=\(text, privacy: .private(mask: .hash))"
                )
            case .count(let count):
                logger.log(
                    level: Self.osLogType(for: entry.level),
                    "\(key, privacy: .public)=\(count, privacy: .public)"
                )
            }
        }
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

/// Collects entries instead of writing them. Used by tests to assert what a
/// device would have recorded.
public final class RecordingLogger: AppLogging {
    private let entries = OSAllocatedUnfairLock<[LogEntry]>(initialState: [])

    public init() {}

    public func log(_ entry: LogEntry) {
        entries.withLock { $0.append(entry) }
    }

    public var recorded: [LogEntry] {
        entries.withLock { $0 }
    }

    /// What the entries would look like once redacted.
    public var renderedLines: [String] {
        recorded.map(LogRedaction.render)
    }
}
