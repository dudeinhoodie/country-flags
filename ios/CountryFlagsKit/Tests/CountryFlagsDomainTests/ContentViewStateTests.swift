import XCTest

@testable import CountryFlagsDomain

/// The rule every content screen shares: what is stored decides whether the
/// user sees content, and a failed refresh only decorates it.
final class ContentViewStateTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testNothingStoredAndNoSyncYetIsLoading() {
        let state = ContentViewState<[Int]>.resolve(
            value: [],
            isEmpty: true,
            status: ContentSyncStatus(),
            now: now
        )

        XCTAssertEqual(state, .loading)
    }

    /// A release that genuinely publishes nothing is not a failure, and saying
    /// "loading" forever would be a lie.
    func testNothingStoredAfterASuccessfulSyncIsEmpty() {
        let state = ContentViewState<[Int]>.resolve(
            value: [],
            isEmpty: true,
            status: ContentSyncStatus(lastSuccessAt: now),
            now: now
        )

        XCTAssertEqual(state, .empty)
    }

    func testNothingStoredAndAFailedSyncIsFailed() {
        let state = ContentViewState<[Int]>.resolve(
            value: [],
            isEmpty: true,
            status: ContentSyncStatus(lastFailure: .offline),
            now: now
        )

        XCTAssertEqual(state, .failed(.offline))
    }

    /// The requirement this whole layer exists for: being offline with a
    /// downloaded catalog shows the catalog, and only marks it.
    func testStoredContentIsShownEvenWhenTheRefreshFailed() {
        let state = ContentViewState.resolve(
            value: [1, 2],
            isEmpty: false,
            status: ContentSyncStatus(lastSuccessAt: now, lastFailure: .offline),
            now: now
        )

        XCTAssertEqual(state, .ready([1, 2], isStale: false, failure: .offline))
    }

    func testContentOlderThanTheThresholdIsStale() {
        let old = now.addingTimeInterval(-ContentSyncStatus.stalenessThreshold - 1)
        let state = ContentViewState.resolve(
            value: [1],
            isEmpty: false,
            status: ContentSyncStatus(lastSuccessAt: old),
            now: now
        )

        XCTAssertEqual(state, .ready([1], isStale: true, failure: nil))
    }

    func testContentInsideTheThresholdIsFresh() {
        let recent = now.addingTimeInterval(-ContentSyncStatus.stalenessThreshold + 1)
        let state = ContentViewState.resolve(
            value: [1],
            isEmpty: false,
            status: ContentSyncStatus(lastSuccessAt: recent),
            now: now
        )

        XCTAssertEqual(state, .ready([1], isStale: false, failure: nil))
    }

    /// Content that was never synced is stale by definition, not fresh.
    func testContentWithNoRecordedSyncIsStale() {
        XCTAssertTrue(ContentSyncStatus().isStale(now: now))
    }

    /// An outdated build cannot fix itself by asking again, and offering a
    /// retry that cannot work is worse than not offering one.
    func testOnlySomeFailuresAreWorthRetrying() {
        XCTAssertTrue(ContentSyncFailure.offline.isRetryable)
        XCTAssertTrue(ContentSyncFailure.recoverable(code: "INTERNAL").isRetryable)
        XCTAssertFalse(ContentSyncFailure.clientTooOld(minimumVersion: "2.0.0").isRetryable)
    }
}
