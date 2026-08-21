import XCTest

@testable import CountryFlagsFeatures

/// The line a guest reads under the first screen.
///
/// Its job is not to report a number but to name the one thing that moves the
/// answers, so the checks here are about the mechanism that could break it
/// silently rather than about the wording, which is free to change.
final class SyncCopyTests: XCTestCase {
    /// `String(format:)` hands back the plural rule itself and formats the
    /// number into whichever variant it happened to pick, so "1 ответов"
    /// reaches the screen and nothing fails. Only
    /// `localizedStringWithFormat` applies the rule.
    func testTheGuestLineDeclinesWithTheCount() {
        let one = L10n.syncSavedOnDevice(1)
        let several = L10n.syncSavedOnDevice(5)

        XCTAssertTrue(one.contains("1"))
        XCTAssertTrue(several.contains("5"))
        XCTAssertNotEqual(
            one.replacingOccurrences(of: "1", with: ""),
            several.replacingOccurrences(of: "5", with: ""),
            "the count is formatted in but the plural rule is not applied"
        )
    }

    /// Saying only that the answers are saved leaves the reader with nothing
    /// to do. The line has to name signing in, which is what carries them over.
    func testTheGuestLinePointsAtSigningIn() {
        let line = L10n.syncSavedOnDevice(12)

        XCTAssertTrue(
            line.localizedCaseInsensitiveContains("аккаунт")
                || line.localizedCaseInsensitiveContains("account"),
            "the line names the count but not the way out: \(line)"
        )
    }
}
