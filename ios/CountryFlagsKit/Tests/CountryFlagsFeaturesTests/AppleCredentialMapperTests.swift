import XCTest

import CountryFlagsDomain
@testable import CountryFlagsFeatures

final class AppleCredentialMapperTests: XCTestCase {
    func testATokenAndACodeBecomeAnAppleCredential() throws {
        let credential = AppleCredentialMapper.credential(
            identityToken: Data("identity".utf8),
            authorizationCode: Data("authorization".utf8),
            rawNonce: "raw-nonce"
        )

        guard case .apple(let token, let code, let nonce) = try XCTUnwrap(credential) else {
            return XCTFail("Expected an Apple credential")
        }
        XCTAssertEqual(token, "identity")
        XCTAssertEqual(code, "authorization")
        XCTAssertEqual(nonce, "raw-nonce")
    }

    /// Either half missing means there is nothing to exchange — not something
    /// to guess at.
    func testAMissingTokenOrCodeYieldsNoCredential() {
        XCTAssertNil(
            AppleCredentialMapper.credential(
                identityToken: nil,
                authorizationCode: Data("authorization".utf8),
                rawNonce: "raw-nonce"
            )
        )
        XCTAssertNil(
            AppleCredentialMapper.credential(
                identityToken: Data("identity".utf8),
                authorizationCode: nil,
                rawNonce: "raw-nonce"
            )
        )
        XCTAssertNil(
            AppleCredentialMapper.credential(
                identityToken: Data(),
                authorizationCode: Data("authorization".utf8),
                rawNonce: "raw-nonce"
            )
        )
    }
}
