import XCTest

import CountryFlagsDomain
@testable import CountryFlagsFeatures

/// When the cold launch's splash gives way, and to what (#501).
///
/// The splash stands in for the loading views and for nothing else: it lasts
/// exactly as long as Home's own placeholder would have, steps aside at once
/// for a screen with something to say, and never holds a slow launch longer
/// than its cap.
final class LaunchSplashTests: XCTestCase {
    private let readyCatalog = ContentViewState<[CatalogSection]>.ready(
        [],
        isStale: false,
        failure: nil
    )

    // MARK: - What is behind it

    func testAFirstLaunchStillReadingTheCatalogIsAWait() {
        XCTAssertEqual(
            LaunchSplash.behind(
                isLaunchWaiting: true,
                launchWaitFails: false,
                catalog: .loading,
                isAwaitingProgress: true,
                isSettling: true
            ),
            .launchWait
        )
    }

    /// The server could not be reached and the wait says so, with its retry.
    /// That is a message, whichever wait it interrupted.
    func testAFailedWaitIsAMessage() {
        XCTAssertEqual(
            LaunchSplash.behind(
                isLaunchWaiting: true,
                launchWaitFails: true,
                catalog: readyCatalog,
                isAwaitingProgress: true,
                isSettling: false
            ),
            .launchFailure
        )
    }

    /// The window a cold launch used to spend in skeletons: the shell is
    /// open, the catalogue is on the device, and the launch's own run has not
    /// come back yet.
    func testHomeIsLoadingWhileTheLaunchRunIsOut() {
        XCTAssertEqual(
            LaunchSplash.behind(
                isLaunchWaiting: false,
                launchWaitFails: false,
                catalog: readyCatalog,
                isAwaitingProgress: false,
                isSettling: true
            ),
            .homeLoading
        )
    }

    func testHomeIsLoadingWhileAnAccountsCountsHaveNeverArrived() {
        XCTAssertEqual(
            LaunchSplash.behind(
                isLaunchWaiting: false,
                launchWaitFails: false,
                catalog: readyCatalog,
                isAwaitingProgress: true,
                isSettling: false
            ),
            .homeLoading
        )
    }

    func testHomeIsReadyOnceTheCatalogAndTheCountsAreIn() {
        XCTAssertEqual(
            LaunchSplash.behind(
                isLaunchWaiting: false,
                launchWaitFails: false,
                catalog: readyCatalog,
                isAwaitingProgress: false,
                isSettling: false
            ),
            .home
        )
    }

    /// An empty release and a catalogue that could not be fetched are Home's
    /// own screens, each with its words and its retry — answers, not waits.
    func testAnUnavailableCatalogIsAnAnswer() {
        for catalog: ContentViewState<[CatalogSection]> in [.empty, .failed(.offline)] {
            XCTAssertEqual(
                LaunchSplash.behind(
                    isLaunchWaiting: false,
                    launchWaitFails: false,
                    catalog: catalog,
                    isAwaitingProgress: true,
                    isSettling: true
                ),
                .home
            )
        }
    }

    // MARK: - When it gives way

    func testItHoldsOverALoadingScreenUntilTheCap() {
        for behind: LaunchSplash.Behind in [.launchWait, .homeLoading] {
            XCTAssertFalse(LaunchSplash.givesWay(to: behind, hasTimedOut: false), "\(behind)")
            XCTAssertTrue(
                LaunchSplash.givesWay(to: behind, hasTimedOut: true),
                "a slow network held the splash past its cap: \(behind)"
            )
        }
    }

    /// The acceptance criterion with the backend unreachable: the failure
    /// screen appears, and the splash does not wait out its cap in front of
    /// it.
    func testItGivesWayToTheFailureScreenAtOnce() {
        XCTAssertTrue(LaunchSplash.givesWay(to: .launchFailure, hasTimedOut: false))
    }

    func testItGivesWayToAReadyHome() {
        XCTAssertTrue(LaunchSplash.givesWay(to: .home, hasTimedOut: false))
    }

    /// The failure the splash steps aside for is the one the wait screen
    /// draws: a retry in flight is a spinner again, and the splash may cover
    /// a spinner.
    func testTheWaitReportsAFailureOnlyWhileNothingIsBeingRetried() {
        XCTAssertTrue(LaunchWaitScreen.reportsFailure(.offline, isRetrying: false))
        XCTAssertFalse(LaunchWaitScreen.reportsFailure(.offline, isRetrying: true))
        XCTAssertFalse(LaunchWaitScreen.reportsFailure(nil, isRetrying: false))
    }

    /// The cap is what keeps a slow network from being held behind the app's
    /// name. Past three seconds a launch starts to read as hung.
    func testTheCapIsShort() {
        XCTAssertGreaterThan(LaunchSplash.cap, .zero)
        XCTAssertLessThanOrEqual(LaunchSplash.cap, .seconds(3))
        XCTAssertLessThan(LaunchSplash.settle, LaunchSplash.cap)
    }

    // MARK: - The name

    /// The splash names the build that was tapped, the way the home screen
    /// does under its icon.
    func testTheNameIsTheBundlesDisplayName() {
        XCTAssertEqual(LaunchSplash.appName(bundleDisplayName: "Vexi Dev"), "Vexi Dev")
    }

    func testABundleWithoutADisplayNameFallsBackToTheShellTitle() {
        for missing in [nil, "", "  "] as [String?] {
            let name = LaunchSplash.appName(bundleDisplayName: missing)
            XCTAssertEqual(name, L10n.shellTitle)
            XCTAssertFalse(name.isEmpty)
            XCTAssertFalse(name.hasPrefix("shell."), "untranslated key on the splash: \(name)")
        }
    }
}
