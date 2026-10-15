import XCTest

@testable import CountryFlagsDomain

/// What the backend's version policy asks of a build (#447).
final class ClientUpdateRequirementTests: XCTestCase {
    /// A forced policy blocks a build below the minimum.
    func testAForcedPolicyBlocksABuildBelowTheMinimum() {
        let policy = ClientVersionPolicy(
            minimumSupported: "0.3.0",
            latest: "0.4.0",
            updateMode: .forced
        )

        XCTAssertEqual(
            policy.requirement(forAppVersion: "0.2.0"),
            .required(minimumSupported: "0.3.0")
        )
        XCTAssertEqual(policy.requirement(forAppVersion: "0.3.0"), .recommended(latest: "0.4.0"))
        XCTAssertEqual(policy.requirement(forAppVersion: "0.4.0"), .none)
        XCTAssertEqual(policy.requirement(forAppVersion: "1.0.0"), .none)
    }

    /// A soft policy only ever recommends, even to a build below the minimum.
    func testASoftPolicyNeverBlocks() {
        let policy = ClientVersionPolicy(
            minimumSupported: "0.3.0",
            latest: "0.4.0",
            updateMode: .soft
        )

        XCTAssertEqual(policy.requirement(forAppVersion: "0.2.0"), .recommended(latest: "0.4.0"))
        XCTAssertEqual(policy.requirement(forAppVersion: "0.4.0"), .none)
    }

    /// `NONE` asks nothing whatever the numbers say. The backend sends it
    /// with placeholder versions above every build that exists today.
    func testNoneAsksNothingEvenBelowThePlaceholders() {
        let policy = ClientVersionPolicy(
            minimumSupported: "1.0.0",
            latest: "1.0.0",
            updateMode: .none
        )

        XCTAssertEqual(policy.requirement(forAppVersion: "0.2.0"), .none)
    }

    /// Numbers compare as numbers, and a missing patch reads as zero.
    func testVersionsCompareNumerically() {
        let policy = ClientVersionPolicy(
            minimumSupported: "0.10.0",
            latest: "0.10.0",
            updateMode: .forced
        )

        XCTAssertEqual(
            policy.requirement(forAppVersion: "0.9.9"),
            .required(minimumSupported: "0.10.0")
        )
        XCTAssertEqual(policy.requirement(forAppVersion: "0.10"), .none)
        XCTAssertEqual(policy.requirement(forAppVersion: "0.11.0"), .none)
    }

    /// A version that cannot be read, on either side, never locks anybody
    /// out: the gate can only stop the app, and a malformed number is not a
    /// reason to.
    func testUnreadableVersionsAskNothing() {
        let forced = ClientVersionPolicy(
            minimumSupported: "0.3.0",
            latest: "0.3.0",
            updateMode: .forced
        )
        XCTAssertEqual(forced.requirement(forAppVersion: "0.2.0-beta"), .none)
        XCTAssertEqual(forced.requirement(forAppVersion: ""), .none)
        XCTAssertEqual(forced.requirement(forAppVersion: "1.2.3.4"), .none)

        let garbled = ClientVersionPolicy(
            minimumSupported: "latest",
            latest: "soon",
            updateMode: .forced
        )
        XCTAssertEqual(garbled.requirement(forAppVersion: "0.2.0"), .none)
    }
}
