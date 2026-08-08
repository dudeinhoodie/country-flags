import Foundation
import OpenAPIRuntime

/// The largest request body the client will hold in memory to be able to
/// resend it. Review batches cap at 500 events, so this is far above anything
/// the contract allows.
private let maximumResendableBodyBytes = 4 * 1024 * 1024

/// A request body kept around so an attempt can be repeated.
///
/// An `HTTPBody` may be a one-shot stream. Handing the same instance to a
/// second attempt would send an empty body, so retrying and refreshing both
/// need the bytes buffered before the first attempt and a fresh body per
/// attempt.
struct BufferedBody: Sendable {
    private let bytes: ArraySlice<UInt8>?

    static func collect(_ body: HTTPBody?) async throws -> BufferedBody {
        guard let body else { return BufferedBody(bytes: nil) }
        let bytes = try await ArraySlice(collecting: body, upTo: maximumResendableBodyBytes)
        return BufferedBody(bytes: bytes)
    }

    private init(bytes: ArraySlice<UInt8>?) {
        self.bytes = bytes
    }

    /// A body that has not been consumed yet.
    func makeBody() -> HTTPBody? {
        guard let bytes else { return nil }
        return HTTPBody(bytes)
    }
}
