import XCTest

@testable import CountryFlagsFeatures

/// What the launch screen waits for, and what it says while it waits.
///
/// The screen is held until every first request has landed (#247), so it is
/// the first thing most people read — and it was telling a guest their account
/// was being prepared, naming something they do not have over work that is not
/// happening (#270).
final class LaunchWaitTests: XCTestCase {
    // MARK: - Which wait

    func testAFirstLaunchWaitsForTheCatalog() {
        XCTAssertEqual(
            LaunchWaitScreen.Reason.waiting(
                hasCatalog: false,
                isGuest: nil,
                origin: .awaitingBackend,
                hasCheckedNumbers: true
            ),
            .catalog
        )
    }

    /// The defect: a guest has no account, so no wait of theirs may name one.
    /// Their first launch resolves the scope and the catalogue in parallel, so
    /// the case to guard is the one where the numbers are still unread.
    func testAGuestIsNeverToldAboutAnAccount() {
        XCTAssertEqual(
            LaunchWaitScreen.Reason.waiting(
                hasCatalog: false,
                isGuest: true,
                origin: .awaitingBackend,
                hasCheckedNumbers: true
            ),
            .catalog
        )
        XCTAssertNil(
            LaunchWaitScreen.Reason.waiting(
                hasCatalog: true,
                isGuest: true,
                origin: .device,
                hasCheckedNumbers: true
            ),
            "a guest's numbers are local and complete, so nothing is waited for"
        )
    }

    func testAnAccountWaitsForItsNumbersOnceTheCatalogIsThere() {
        XCTAssertEqual(
            LaunchWaitScreen.Reason.waiting(
                hasCatalog: true,
                isGuest: false,
                origin: .awaitingBackend,
                hasCheckedNumbers: true
            ),
            .account
        )
    }

    /// Whose numbers these are is resolved by a read of its own, so there is a
    /// moment when the catalogue is there and the scope is not known yet. The
    /// app must not be let in then — that early frame is what #247 fixed — and
    /// must not claim an account it cannot see.
    func testAnUnknownScopeKeepsWaitingWithoutNamingAnAccount() {
        XCTAssertEqual(
            LaunchWaitScreen.Reason.waiting(
                hasCatalog: true,
                isGuest: nil,
                origin: .awaitingBackend,
                hasCheckedNumbers: true
            ),
            .catalog
        )
    }

/// Reading the stored counts is not the same as knowing them.
    ///
    /// The app opened as soon as the store had been read, which is the word
    /// it was last told — so the first thing a learner saw was the deck they
    /// had, then a spinner, then the numbers they actually have. The wait
    /// holds until the launch's own run has come back.
    func testTheWaitHoldsUntilTheNumbersHaveBeenChecked() {
        XCTAssertEqual(
            LaunchWaitScreen.Reason.waiting(
                hasCatalog: true,
                isGuest: false,
                origin: .backend,
                hasCheckedNumbers: false
            ),
            .account
        )
    }

    /// A guest waits under the wording that claims no account, here as
    /// everywhere else.
    func testAGuestWaitingOnTheRunIsStillNotToldAboutAnAccount() {
        XCTAssertEqual(
            LaunchWaitScreen.Reason.waiting(
                hasCatalog: true,
                isGuest: true,
                origin: .device,
                hasCheckedNumbers: false
            ),
            .catalog
        )
    }

    func testTheAppIsLetInOnceTheNumbersHaveLanded() {
        XCTAssertNil(
            LaunchWaitScreen.Reason.waiting(
                hasCatalog: true,
                isGuest: false,
                origin: .backend,
                hasCheckedNumbers: true
            )
        )
    }

    // MARK: - What it says

    /// Every key resolves: a missing entry in the string catalog comes back as
    /// the key itself, which reaches the screen and fails nothing.
    func testTheWaitCopyIsTranslated() {
        let copy = [
            L10n.launchCatalogTitle,
            L10n.launchCatalogSubtitle,
            L10n.launchCatalogFailedSubtitle,
            L10n.launchAccountTitle,
            L10n.launchAccountSubtitle,
            L10n.launchAccountFailedSubtitle,
            L10n.launchFailedTitle,
            L10n.launchRetry,
        ]

        for line in copy {
            XCTAssertFalse(line.hasPrefix("launch."), "untranslated key on screen: \(line)")
            XCTAssertFalse(line.isEmpty)
        }
    }

    /// The wording is free to change; naming an account to someone who has
    /// none is the thing that must not come back.
    func testTheCatalogWaitDoesNotMentionAnAccount() {
        for line in [L10n.launchCatalogTitle, L10n.launchCatalogSubtitle, L10n.launchCatalogFailedSubtitle] {
            XCTAssertFalse(
                line.localizedCaseInsensitiveContains("аккаунт")
                    || line.localizedCaseInsensitiveContains("account"),
                "the catalogue wait names an account: \(line)"
            )
        }
    }

    func testTheAccountWaitSaysWhoseNumbersAreComing() {
        XCTAssertTrue(
            L10n.launchAccountTitle.localizedCaseInsensitiveContains("аккаунт")
                || L10n.launchAccountTitle.localizedCaseInsensitiveContains("account"),
            "the account wait does not say what it is waiting for: \(L10n.launchAccountTitle)"
        )
    }
}
