import XCTest

import CountryFlagsDomain
@testable import CountryFlagsFeatures

@MainActor
final class AppRouterTests: XCTestCase {
    func testPushAndPopTrackTheCurrentRoute() {
        let router = AppRouter()
        XCTAssertNil(router.currentRoute)

        router.push(.catalog)
        router.push(.settings)
        XCTAssertEqual(router.path, [.catalog, .settings])
        XCTAssertEqual(router.currentRoute, .settings)

        router.pop()
        XCTAssertEqual(router.currentRoute, .catalog)

        router.popToRoot()
        XCTAssertTrue(router.path.isEmpty)
        // An extra pop on an empty stack must not break anything.
        router.pop()
        XCTAssertTrue(router.path.isEmpty)
    }

    func testDeepLinkReplacesTheStack() throws {
        let router = AppRouter(path: [.catalog, .settings])
        let parser = DeepLinkParser(scheme: "countryflags")
        let deckId = try XCTUnwrap(UUID(uuidString: "70000000-0000-4000-8000-000000000001"))
        let url = try XCTUnwrap(URL(string: "countryflags://deck/\(deckId.uuidString)"))

        XCTAssertTrue(router.open(url, using: parser))
        XCTAssertEqual(router.path, [.deck(id: deckId)])
    }

    /// An unknown link must not silently change navigation.
    func testUnknownDeepLinkKeepsCurrentStack() throws {
        let router = AppRouter(path: [.catalog])
        let parser = DeepLinkParser(scheme: "countryflags")
        let url = try XCTUnwrap(URL(string: "countryflags://unknown"))

        XCTAssertFalse(router.open(url, using: parser))
        XCTAssertEqual(router.path, [.catalog])
    }

    // MARK: - After a sign-in (#498)

    /// A sign-in lands on Home with every stack at its root, whichever tab it
    /// was started from and whatever the other tabs were showing.
    func testASignInLandsOnHomeWithEveryStackAtItsRoot() throws {
        let deckID = try XCTUnwrap(UUID(uuidString: "70000000-0000-4000-8000-000000000001"))
        let router = AppRouter(path: [.deck(id: deckID)])
        router.tab = .catalog
        router.push(.deck(id: deckID))
        router.achievementsNavigationPath = [.settings]
        router.tab = .progress
        // The avatar, which pushes the account screen onto a tab's root.
        router.push(.account)

        router.landAfterSignIn()

        XCTAssertEqual(router.tab, .home)
        XCTAssertTrue(router.homePath.isEmpty)
        XCTAssertTrue(router.catalogPath.isEmpty)
        XCTAssertTrue(router.progressPath.isEmpty)
        XCTAssertTrue(router.achievementsPath.isEmpty)
    }

    /// The account screen opened from the avatar on a tab's root is not the
    /// paywall's, so signing in there goes to Home like any other door.
    func testASignInOnTheAccountScreenFromTheAvatarLandsOnHome() {
        let router = AppRouter()
        router.tab = .catalog
        router.push(.account)

        router.landAfterSignIn()

        XCTAssertEqual(router.tab, .home)
        XCTAssertTrue(router.catalogPath.isEmpty)
    }

    /// The paywall's sign-in is half of a purchase, and the purchase goes on
    /// from the deck: only the account screen it pushed is taken away, and
    /// the tab and every other stack stay as they were.
    func testASignInThePaywallAskedForReturnsToTheDeck() throws {
        let deckID = try XCTUnwrap(UUID(uuidString: "70000000-0000-4000-8000-000000000002"))
        let router = AppRouter(path: [.settings])
        router.tab = .catalog
        router.push(.deck(id: deckID))
        // The paywall's "sign in to buy".
        router.push(.account)

        router.landAfterSignIn()

        XCTAssertEqual(router.tab, .catalog)
        XCTAssertEqual(router.catalogPath, [.deck(id: deckID)])
        XCTAssertEqual(router.homePath, [.settings])
    }

    /// The same deck reached from Home, through a stack that holds more than
    /// the deck: what decides is the deck directly under the account screen.
    func testThePaywallsSignInReturnsToTheDeckOnWhicheverTabItWasOpened() throws {
        let deckID = try XCTUnwrap(UUID(uuidString: "70000000-0000-4000-8000-000000000003"))
        let router = AppRouter(path: [.catalog, .deck(id: deckID), .account])

        router.landAfterSignIn()

        XCTAssertEqual(router.tab, .home)
        XCTAssertEqual(router.homePath, [.catalog, .deck(id: deckID)])
    }
}

final class LocalizationTests: XCTestCase {
    /// The string catalog has to be compiled into the package resources;
    /// otherwise `String(localized:)` would return the key itself.
    func testStringCatalogIsCompiledIntoTheBundle() {
        for (key, value) in [
            ("shell.title", L10n.shellTitle),
            ("shell.subtitle", L10n.shellSubtitle),
            ("shell.open_settings", L10n.shellOpenSettings),
            ("settings.title", L10n.settingsTitle),
            ("progress.empty.title", L10n.progressEmptyTitle),
            ("settings.reminders", L10n.settingsReminders),
            ("mastery.gold", L10n.masteryGold),
        ] {
            XCTAssertNotEqual(value, key, "\(key) has no localization")
            XCTAssertFalse(value.isEmpty)
        }
    }

    /// The first release ships Russian and English.
    func testBothReleaseLanguagesAreShipped() {
        let localizations = Set(L10n.bundle.localizations)
        XCTAssertTrue(
            localizations.isSuperset(of: ["en", "ru"]),
            "package bundle ships \(localizations.sorted())"
        )
    }
}
