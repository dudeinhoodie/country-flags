import Foundation
import OpenAPIRuntime

/// Reads and writes the timestamps the backend actually produces.
///
/// The runtime default accepts ISO 8601 without fractional seconds, while the
/// backend serializes every instant through `Date.toISOString()`, which always
/// includes milliseconds. Without this transcoder every response carrying a
/// timestamp fails to decode.
struct FractionalSecondsDateTranscoder: DateTranscoder {
    /// `ISO8601DateFormatter` is not `Sendable`, so each call gets its own
    /// instance rather than sharing mutable state across concurrent requests.
    private static func formatter(fractionalSeconds: Bool) -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = fractionalSeconds
            ? [.withInternetDateTime, .withFractionalSeconds]
            : [.withInternetDateTime]
        return formatter
    }

    /// Milliseconds are always sent: the backend accepts them and a client that
    /// dropped them would lose ordering precision on review events.
    func encode(_ date: Date) throws -> String {
        Self.formatter(fractionalSeconds: true).string(from: date)
    }

    func decode(_ dateString: String) throws -> Date {
        if let date = Self.formatter(fractionalSeconds: true).date(from: dateString) {
            return date
        }
        // A timestamp that lands exactly on a second may arrive without them.
        if let date = Self.formatter(fractionalSeconds: false).date(from: dateString) {
            return date
        }
        throw DecodingError.dataCorrupted(
            DecodingError.Context(
                codingPath: [],
                debugDescription: "Expected an ISO 8601 date-time, received \(dateString)"
            )
        )
    }
}
