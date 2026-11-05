import XCTest

@testable import CountryFlagsFeatures

/// The result's heap of flags (#519): sized by the sitting, inside the
/// margins, and the same every time for the same flags.
final class ResultHeapLayoutTests: XCTestCase {
    private let width: CGFloat = 370

    private func seeds(_ count: Int) -> [UInt64] {
        (0..<count).map { ResultHeapLayout.seed(for: UUID(uuidString: String(format: "60000000-0000-4000-8000-%012d", $0))!) }
    }

    /// Five cards lie at the large size, ten at the middle one, twenty at the
    /// small one, as the rules board draws them.
    func testTheCardSizeFollowsTheSittingsSize() {
        XCTAssertEqual(ResultHeapLayout.plan(seeds: seeds(5), width: width).places.first?.size.width, 156)
        XCTAssertEqual(ResultHeapLayout.plan(seeds: seeds(10), width: width).places.first?.size.width, 140)
        XCTAssertEqual(ResultHeapLayout.plan(seeds: seeds(20), width: width).places.first?.size.width, 124)
    }

    /// No card leaves the 16-point margins, nudges included.
    func testEveryCardStaysInsideTheMargins() {
        for count in [1, 5, 10, 20, 24] {
            let plan = ResultHeapLayout.plan(seeds: seeds(count), width: width)
            XCTAssertEqual(plan.places.count, count)
            for place in plan.places {
                XCTAssertGreaterThanOrEqual(place.center.x - place.size.width / 2, 16 - 0.001, "\(count) cards")
                XCTAssertLessThanOrEqual(place.center.x + place.size.width / 2, width - 16 + 0.001, "\(count) cards")
                XCTAssertLessThanOrEqual(place.center.y + place.size.height / 2, plan.height, "\(count) cards")
            }
        }
    }

    /// A flag waits wholly beyond the screen's side edge, on the side nearer
    /// its place (#554). One that waited on screen was seen before it flew.
    func testEveryFlagSetsOffBeyondTheSideOfTheScreen() {
        for screenWidth: CGFloat in [375, 402, 768] {
            let heapWidth = min(520, screenWidth - 32)
            let margin = (screenWidth - heapWidth) / 2
            for count in [1, 5, 10, 20] {
                let plan = ResultHeapLayout.plan(seeds: seeds(count), width: heapWidth)
                for place in plan.places {
                    let launch = ResultHeapLayout.launch(
                        for: place,
                        heapWidth: heapWidth,
                        screenWidth: screenWidth
                    )
                    let reach = hypot(place.size.width, place.size.height) / 2 * ResultHeapLayout.launchScale
                    if place.center.x < heapWidth / 2 {
                        XCTAssertLessThanOrEqual(launch.center.x + reach, -margin, "\(count) cards, \(screenWidth) pt")
                    } else {
                        XCTAssertGreaterThanOrEqual(launch.center.x - reach, heapWidth + margin, "\(count) cards, \(screenWidth) pt")
                    }
                }
            }
        }
    }

    /// The same flags lie the same way every time: the nudges come from the
    /// flags themselves, not from a launch-seeded hash.
    func testTheHeapIsStableForTheSameFlags() {
        let first = ResultHeapLayout.plan(seeds: seeds(10), width: width)
        let second = ResultHeapLayout.plan(seeds: seeds(10), width: width)

        XCTAssertEqual(first.places.map(\.center.x), second.places.map(\.center.x))
        XCTAssertEqual(first.places.map(\.rotation), second.places.map(\.rotation))
    }

    /// A narrow screen scales the cards down rather than clipping a row.
    func testANarrowScreenScalesTheCardsDown() {
        let narrow = ResultHeapLayout.plan(seeds: seeds(10), width: 300)

        XCTAssertLessThan(narrow.places.first?.size.width ?? 0, 140)
    }
}
