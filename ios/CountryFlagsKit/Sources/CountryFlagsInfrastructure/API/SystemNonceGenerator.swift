import CryptoKit
import Foundation
import Security

import CountryFlagsDomain

/// Draws the one-time value that ties a provider's identity token to this
/// sign-in.
///
/// The raw value comes from the system's random source; the provider is shown
/// only its SHA-256. Apple signs the hash into the identity token and the
/// backend compares it against the raw value this device kept, so a token
/// captured elsewhere cannot be replayed into this session.
public struct SystemNonceGenerator: NonceGenerating {
    public init() {}

    public func makeNonce() -> SignInNonce {
        let raw = Self.randomString(length: 32)
        let digest = SHA256.hash(data: Data(raw.utf8))
        let hashed = digest.map { String(format: "%02x", $0) }.joined()
        return SignInNonce(raw: raw, hashed: hashed)
    }

    /// Alphanumerics only: the value travels inside a signed JWT claim and a
    /// JSON body, and a charset nobody has to escape cannot be corrupted by
    /// either.
    private static let charset = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")

    private static func randomString(length: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: length)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            // The system generator is also cryptographic; a nonce must never
            // be skipped just because the preferred source refused.
            var generator = SystemRandomNumberGenerator()
            bytes = (0..<length).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
        }
        return String(bytes.map { charset[Int($0) % charset.count] })
    }
}
