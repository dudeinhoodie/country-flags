import XCTest

@testable import CountryFlagsFeatures

/// When coming back to the app checks anything (#506).
///
/// Every turn to `.active` used to run the whole foreground pass, and the
/// scene turns active after far more than a return: Notification Centre,
/// Control Centre, a Face ID prompt and a peek at the app switcher all pass
/// through `.inactive` and back. The rule is now a real return from the
/// background, after at least a minute away.
final class ForegroundCheckTests: XCTestCase {
    // MARK: - Background and back

    func testComingBackFromTheBackgroundAfterAMinuteChecks() {
        XCTAssertTrue(
            ForegroundCheck.isDue(wentToBackground: true, away: .seconds(61))
        )
        XCTAssertTrue(
            ForegroundCheck.isDue(wentToBackground: true, away: .seconds(3 * 60 * 60)),
            "a phone locked for hours is the case the check exists for"
        )
    }

    // MARK: - An inactive spell

    /// The defect: pulling down Notification Centre over the app and letting
    /// it go reloaded Home. The scene never left the screen, so nothing runs.
    func testAnInactiveSpellChecksNothing() {
        XCTAssertFalse(
            ForegroundCheck.isDue(wentToBackground: false, away: .zero)
        )
    }

    /// The time is not what decides it: however long the scene sat inactive
    /// — a Face ID prompt left up, a call banner — the app stayed on screen.
    func testALongInactiveSpellStillChecksNothing() {
        XCTAssertFalse(
            ForegroundCheck.isDue(wentToBackground: false, away: .seconds(600))
        )
    }

    // MARK: - The threshold

    func testComingBackWithinAMinuteChecksNothing() {
        XCTAssertFalse(
            ForegroundCheck.isDue(wentToBackground: true, away: .seconds(1))
        )
        XCTAssertFalse(
            ForegroundCheck.isDue(wentToBackground: true, away: .seconds(59))
        )
        XCTAssertFalse(
            ForegroundCheck.isDue(wentToBackground: true, away: .milliseconds(59_999))
        )
    }

    /// A minute away is long enough: the threshold itself counts.
    func testExactlyAMinuteAwayChecks() {
        XCTAssertTrue(
            ForegroundCheck.isDue(wentToBackground: true, away: .seconds(60))
        )
    }

    func testTheThresholdIsAMinute() {
        XCTAssertEqual(ForegroundCheck.minimumAway, .seconds(60))
    }

    /// The threshold is an input, so the rule does not quietly ignore one it
    /// is handed.
    func testAThresholdPassedInIsTheOneApplied() {
        XCTAssertFalse(
            ForegroundCheck.isDue(
                wentToBackground: true,
                away: .seconds(9),
                threshold: .seconds(10)
            )
        )
        XCTAssertTrue(
            ForegroundCheck.isDue(
                wentToBackground: true,
                away: .seconds(10),
                threshold: .seconds(10)
            )
        )
        XCTAssertFalse(
            ForegroundCheck.isDue(
                wentToBackground: false,
                away: .seconds(10),
                threshold: .zero
            ),
            "no threshold makes an inactive spell a return"
        )
    }
}
