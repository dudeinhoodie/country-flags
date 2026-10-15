import XCTest

/// The cold launch opens on a splash (#501), which takes every touch while it
/// is up and hides what is behind it from the accessibility tree.
///
/// Home's own elements only appear once the splash has gone, so a test that
/// waits for one of them is already past it. A test whose first move is in a
/// bar — the gear, the avatar, a tab — waits here first: the bars belong to
/// UIKit, and a tap sent to one before the splash has gone lands on the
/// splash instead.
@MainActor
extension XCUIApplication {
    /// The splash, while it is up.
    var launchSplash: XCUIElement {
        descendants(matching: .any).matching(identifier: "root.splash").firstMatch
    }

    /// Waits until the splash has given way.
    ///
    /// It is capped at a few seconds in the app, so the timeout here is the
    /// slow simulator's allowance rather than the splash's.
    func waitForTheSplashToLeave(
        timeout: TimeInterval = 20,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertTrue(
            launchSplash.waitForNonExistence(timeout: timeout),
            "The launch splash never gave way\n\(debugDescription)",
            file: file,
            line: line
        )
    }
}
