import CryptoKit
import Foundation

/// A SHA-256 digest as 64 lowercase hex characters: the form the contract
/// carries checksums, entity tags and idempotency keys in.
public enum SHA256Digest {
    public static func hexDigest(of data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
