import XCTest

/// The cold launch opens on a splash (#501), which takes every touch while it
/// is up and hides what is behind it from the accessibility tree.
///
/// Home's own elements only appear once the splash has gone, so a test that
/// waits for one of them is already past it. A test whose first move is in a
/// bar — the avatar, a tab — waits here first: the bars belong to
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

/// "Профиль" holds the account and every setting in one list (#522). A list
/// materialises only the rows on screen, so a row further down does not exist
/// until the list is scrolled to it.
@MainActor
extension XCUIApplication {
    /// Swipes the list up until the element exists and can be pressed, and
    /// returns it either way so the caller's assertion says what was missing.
    @discardableResult
    func reveal(_ element: XCUIElement, swipes: Int = 8) -> XCUIElement {
        var remaining = swipes
        while !(element.exists && element.isHittable), remaining > 0 {
            swipeUp()
            remaining -= 1
        }
        return element
    }

    /// The other way: swipes the list down until the element is back on
    /// screen. The account row heads the list, so a test that went down to an
    /// action at the bottom comes back up before it reads the session.
    @discardableResult
    func revealAbove(_ element: XCUIElement, swipes: Int = 8) -> XCUIElement {
        var remaining = swipes
        while !(element.exists && element.isHittable), remaining > 0 {
            swipeDown()
            remaining -= 1
        }
        return element
    }
}
