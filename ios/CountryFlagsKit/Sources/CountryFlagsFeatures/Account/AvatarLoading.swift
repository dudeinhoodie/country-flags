import Foundation

/// Fetches the picture an identity provider publishes for an account.
///
/// A seam rather than a call to `URLSession` inside the store: a test that
/// exercises signing in should not reach the network for a photograph.
public protocol AvatarLoading: Sendable {
    func data(from url: URL) async throws -> Data
}

/// The real one.
///
/// No cache of its own — the store holds what it fetched, and one avatar per
/// signed-in account is the whole of it. A non-2xx answer is a failure rather
/// than bytes: an error page stored as an avatar would draw as a broken image
/// where a glyph belongs.
public struct URLSessionAvatarLoader: AvatarLoading {
    public init() {}

    public func data(from url: URL) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse,
            (200..<300).contains(http.statusCode)
        else {
            throw URLError(.badServerResponse)
        }
        return data
    }
}
