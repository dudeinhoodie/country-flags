import XCTest

@testable import CountryFlagsFeatures

/// The line on the sign-in screen that names the ways in.
///
/// A Prod build has no Google client and draws no Google button, so the line
/// it shows must not promise one; a build that draws both names both. The
/// brand names are written the same in every language, so the checks hold
/// whichever one the test run resolves.
final class SignInCopyTests: XCTestCase {
    func testABuildWithoutGoogleNamesAppleAlone() {
        let line = L10n.accountSignInBenefitPassword(offersGoogle: false)

        XCTAssertTrue(line.contains("Apple"), line)
        XCTAssertFalse(
            line.contains("Google"),
            "the line promises a button the build does not draw: \(line)"
        )
        XCTAssertFalse(line.contains("account."), "the key reached the screen: \(line)")
    }

    func testABuildWithGoogleNamesBoth() {
        let line = L10n.accountSignInBenefitPassword(offersGoogle: true)

        XCTAssertTrue(line.contains("Apple"), line)
        XCTAssertTrue(line.contains("Google"), line)
    }
}
