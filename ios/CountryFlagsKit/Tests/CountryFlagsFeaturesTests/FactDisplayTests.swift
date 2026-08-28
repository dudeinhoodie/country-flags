import XCTest

import CountryFlagsDomain

@testable import CountryFlagsFeatures

/// How a fact is worded once the parts arrive beside the composed line.
///
/// The client used to take the line apart again — a regular expression pulled
/// ` (NOK)` off a currency and another lifted the year out of a population —
/// which is a guess about how the backend built the sentence. These check that
/// the guessing is gone: where there are parts they decide the wording, and
/// where there are none the line is shown exactly as it arrived (#255).
final class FactDisplayTests: XCTestCase {
    private func fact(
        type: String,
        displayValue: String,
        details: FactDetails?
    ) -> FactRecord {
        FactRecord(
            type: type,
            displayValue: displayValue,
            sourceName: "Test",
            details: details
        )
    }

    /// The line and the parts deliberately disagree: only reading the parts
    /// can produce the expected answer, so a client still parsing the line
    /// fails this.
    func testACurrencyShowsItsNameAndNotTheCodeOnTheNote() {
        let presentation = FactDisplay.presentation(
            for: fact(
                type: "CURRENCY",
                displayValue: "Krone (NOK)",
                details: .currency(tenders: [
                    .init(code: "NOK", name: "Norwegian Krone", role: "official")
                ])
            )
        )

        XCTAssertEqual(presentation.value, "Norwegian Krone")
    }

    func testSeveralTendersAreListed() {
        let presentation = FactDisplay.presentation(
            for: fact(
                type: "CURRENCY",
                displayValue: "ignored",
                details: .currency(tenders: [
                    .init(code: "USD", name: "US Dollar", role: "official"),
                    .init(code: "PAB", name: "Balboa", role: "official"),
                ])
            )
        )

        XCTAssertEqual(presentation.value, "US Dollar, Balboa")
    }

    /// The year is provenance, not part of the number: it belongs in the
    /// label, and the count is compacted to what a person keeps.
    func testAPopulationSplitsTheYearOffIntoTheLabel() {
        let presentation = FactDisplay.presentation(
            for: fact(
                type: "POPULATION",
                displayValue: "8 406 558 (2024)",
                details: .population(value: 8_406_558, year: 2024)
            )
        )

        XCTAssertEqual(presentation.value, "8.4M")
        XCTAssertEqual(presentation.label?.hasSuffix("2024"), true)
    }

    func testAPopulationWithoutAYearKeepsThePlainLabel() {
        let presentation = FactDisplay.presentation(
            for: fact(
                type: "POPULATION",
                displayValue: "1 000",
                details: .population(value: 1000, year: nil)
            )
        )

        XCTAssertEqual(presentation.value, "1K")
        XCTAssertEqual(presentation.label?.contains("("), false)
    }

    /// A count small enough to read is left alone rather than half-formatted.
    func testASmallCountIsNotCompacted() {
        let presentation = FactDisplay.presentation(
            for: fact(
                type: "POPULATION",
                displayValue: "825",
                details: .population(value: 825, year: nil)
            )
        )

        XCTAssertEqual(presentation.value.filter(\.isNumber), "825")
    }

    func testACapitalListsItsSeats() {
        let presentation = FactDisplay.presentation(
            for: fact(
                type: "CAPITAL",
                displayValue: "ignored",
                details: .capital(seats: [
                    .init(name: "Pretoria", role: "official"),
                    .init(name: "Cape Town", role: "legislative"),
                ])
            )
        )

        XCTAssertEqual(presentation.value, "Pretoria, Cape Town")
    }

    /// A release whose stored shape the backend does not model, or a backend
    /// that predates the field: the composed line is all there is, and it is
    /// shown untouched rather than guessed at.
    func testAFactWithoutPartsIsShownAsTheLineItArrivedAs() {
        let presentation = FactDisplay.presentation(
            for: fact(
                type: "CURRENCY",
                displayValue: "Norwegian Krone (NOK)",
                details: nil
            )
        )

        XCTAssertEqual(presentation.value, "Norwegian Krone (NOK)")
    }

    func testCompactingRoundsToOneDecimalBelowTenAndNoneAbove() {
        XCTAssertEqual(FactDisplay.compactNumber(1_400_000), "1.4M")
        XCTAssertEqual(FactDisplay.compactNumber(12_300_000), "12M")
        XCTAssertEqual(FactDisplay.compactNumber(1_000_000), "1M")
        XCTAssertEqual(FactDisplay.compactNumber(2_100_000_000), "2.1B")
    }
}
