import XCTest

@testable import CountryFlagsFeatures

/// The words on Home's known/learned block (#497).
///
/// As with the guest line, the checks are about the mechanism that could
/// break the copy silently — a plural rule that is not applied, a number that
/// is printed twice — rather than about the wording, which is free to change.
final class HomeKnownLearnedCopyTests: XCTestCase {
    /// The caption under the known figure is declined by the count but does
    /// not print it: the figure above it already does, in the hero face. It
    /// is a substitution in the catalogue, the one plural form whose variants
    /// may leave the number out, and a catalogue edit that turned it back into
    /// a plain string would put "40 40 знакомых стран" on the screen or drop
    /// the plural rule without a word.
    func testTheKnownCaptionDeclinesWithoutPrintingTheCount() {
        let one = L10n.homeKnownCaption(1)
        let several = L10n.homeKnownCaption(5)

        XCTAssertFalse(one.contains("1"), one)
        XCTAssertFalse(several.contains("5"), several)
        XCTAssertFalse(several.isEmpty)
        XCTAssertFalse(several.contains("%"), "the format reached the screen: \(several)")
        XCTAssertFalse(several.contains("home."), "the key reached the screen: \(several)")
        XCTAssertNotEqual(one, several, "the plural rule is not applied")
    }

    /// What VoiceOver hears has the number inside the words, and is declined
    /// by it — `String(format:)` would format the number into one arbitrary
    /// variant and say "1 known countries".
    func testTheSpokenKnownCountDeclinesWithTheCount() {
        let one = L10n.homeKnownCount(1)
        let several = L10n.homeKnownCount(5)

        XCTAssertTrue(one.contains("1"), one)
        XCTAssertTrue(several.contains("5"), several)
        XCTAssertNotEqual(
            one.replacingOccurrences(of: "1", with: ""),
            several.replacingOccurrences(of: "5", with: ""),
            "the count is formatted in but the plural rule is not applied"
        )
    }

    /// Both numbers of the learned figure reach the sentence, in their places.
    func testTheSpokenLearnedFigureCarriesBothNumbers() {
        let line = L10n.homeLearnedOf(3, 195)

        XCTAssertTrue(line.contains("3"), line)
        XCTAssertTrue(line.contains("195"), line)
        XCTAssertFalse(line.contains("%"), line)
    }
}
