import CryptoKit
import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

final class NonceGeneratorTests: XCTestCase {
    /// The provider is shown the hash and the backend the raw value; the two
    /// must be the same nonce or the whole tie-together is theatre.
    func testTheHashIsTheSHA256OfTheRawValue() {
        let nonce = SystemNonceGenerator().makeNonce()

        let recomputed = SHA256.hash(data: Data(nonce.raw.utf8))
            .map { String(format: "%02x", $0) }
            .joined()

        XCTAssertEqual(nonce.hashed, recomputed)
    }

    func testTheRawValueIsLongAlphanumericAndFresh() {
        let generator = SystemNonceGenerator()
        let first = generator.makeNonce()
        let second = generator.makeNonce()

        XCTAssertEqual(first.raw.count, 32)
        XCTAssertTrue(first.raw.allSatisfy { $0.isLetter || $0.isNumber })
        // One draw equalling the next would mean the randomness is not there.
        XCTAssertNotEqual(first.raw, second.raw)
    }
}
