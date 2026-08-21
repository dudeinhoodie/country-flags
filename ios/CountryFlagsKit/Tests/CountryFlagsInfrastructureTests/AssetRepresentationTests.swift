import XCTest

@testable import CountryFlagsInfrastructure

/// The rule that decides which raster a screen is given, on its own.
///
/// It is tested apart from the mapper because it is the part with branches:
/// the mapper only carries the answer into a record.
final class AssetRepresentationTests: XCTestCase {
    private typealias Candidate = RenderableRepresentation.Candidate

    private let published = [
        Candidate(mimeType: "image/svg+xml", scale: nil),
        Candidate(mimeType: "image/png", scale: 2),
        Candidate(mimeType: "image/png", scale: 3),
    ]

    func testTheScaleTheScreenActuallyIsWins() {
        XCTAssertEqual(RenderableRepresentation.choose(from: published, displayScale: 3), 2)
        XCTAssertEqual(RenderableRepresentation.choose(from: published, displayScale: 2), 1)
    }

    /// A screen between two published scales takes the one below it rather than
    /// the one above: downscaling a raster looks better than a screen drawing
    /// more pixels than the file has.
    func testAScaleBetweenTwoPublishedOnesTakesTheLower() {
        XCTAssertEqual(RenderableRepresentation.choose(from: published, displayScale: 2.5), 1)
    }

    /// Nothing at or below the screen's scale: the smallest raster still beats
    /// a vector this platform cannot decode.
    func testAScreenBelowEveryPublishedScaleTakesTheFirstItCanDraw() {
        XCTAssertEqual(RenderableRepresentation.choose(from: published, displayScale: 1), 1)
    }

    /// A release published before scales existed, or one that stopped
    /// declaring them, still renders.
    func testRepresentationsWithoutScalesFallBackToPublicationOrder() {
        let unscaled = [
            Candidate(mimeType: "image/svg+xml", scale: nil),
            Candidate(mimeType: "image/png", scale: nil),
            Candidate(mimeType: "image/jpeg", scale: nil),
        ]

        XCTAssertEqual(RenderableRepresentation.choose(from: unscaled, displayScale: 3), 1)
    }

    func testNothingRenderableIsNoChoiceAtAll() {
        let vectorOnly = [Candidate(mimeType: "image/svg+xml", scale: nil)]

        XCTAssertNil(RenderableRepresentation.choose(from: vectorOnly, displayScale: 3))
        XCTAssertNil(RenderableRepresentation.choose(from: [], displayScale: 3))
    }
}
