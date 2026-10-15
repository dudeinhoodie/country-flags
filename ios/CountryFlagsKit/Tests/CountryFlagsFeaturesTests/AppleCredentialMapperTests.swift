import AuthenticationServices
import XCTest

import CountryFlagsDomain
@testable import CountryFlagsFeatures

final class AppleCredentialMapperTests: XCTestCase {
    func testATokenAndACodeBecomeAnAppleCredential() throws {
        let credential = AppleCredentialMapper.credential(
            identityToken: Data("identity".utf8),
            authorizationCode: Data("authorization".utf8),
            rawNonce: "raw-nonce",
            appleUserID: "000123.apple.0456"
        )

        guard case .apple(let token, let code, let nonce, let user) = try XCTUnwrap(credential)
        else {
            return XCTFail("Expected an Apple credential")
        }
        XCTAssertEqual(token, "identity")
        XCTAssertEqual(code, "authorization")
        XCTAssertEqual(nonce, "raw-nonce")
        // Kept by the session to ask Apple later whether the sign-in stands.
        XCTAssertEqual(user, "000123.apple.0456")
    }

    /// Apple's own states, onto the app's. Only a revoked or unknown
    /// identifier ends a session; a transfer between teams does not, and
    /// neither does a check that could not be made.
    func testApplesCredentialStatesMapOntoTheApps() {
        XCTAssertEqual(AppleIDCredentialStateChecker.state(from: .authorized), .authorized)
        XCTAssertEqual(AppleIDCredentialStateChecker.state(from: .revoked), .revoked)
        XCTAssertEqual(AppleIDCredentialStateChecker.state(from: .notFound), .notFound)
        XCTAssertEqual(AppleIDCredentialStateChecker.state(from: .transferred), .transferred)
        XCTAssertTrue(AppleCredentialState.revoked.endsTheSession)
        XCTAssertTrue(AppleCredentialState.notFound.endsTheSession)
        XCTAssertFalse(AppleCredentialState.transferred.endsTheSession)
        XCTAssertFalse(AppleCredentialState.unknown.endsTheSession)
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
