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
        // Пустой стек не должен ломаться от лишнего pop.
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

    /// Неизвестная ссылка не должна тихо менять навигацию.
    func testUnknownDeepLinkKeepsCurrentStack() throws {
        let router = AppRouter(path: [.catalog])
        let parser = DeepLinkParser(scheme: "countryflags")
        let url = try XCTUnwrap(URL(string: "countryflags://unknown"))

        XCTAssertFalse(router.open(url, using: parser))
        XCTAssertEqual(router.path, [.catalog])
    }
}

final class LocalizationTests: XCTestCase {
    /// Каталог строк должен быть собран в ресурсы пакета: иначе
    /// `String(localized:)` вернул бы сам ключ.
    func testStringCatalogIsCompiledIntoTheBundle() {
        for (key, value) in [
            ("shell.title", L10n.shellTitle),
            ("shell.subtitle", L10n.shellSubtitle),
            ("shell.open_settings", L10n.shellOpenSettings),
            ("settings.title", L10n.settingsTitle),
            ("route.not_implemented", L10n.routeNotImplemented),
        ] {
            XCTAssertNotEqual(value, key, "\(key) has no localization")
            XCTAssertFalse(value.isEmpty)
        }
    }

    /// Первый релиз обязан содержать русский и английский.
    func testBothReleaseLanguagesAreShipped() {
        let localizations = Set(L10n.bundle.localizations)
        XCTAssertTrue(
            localizations.isSuperset(of: ["en", "ru"]),
            "package bundle ships \(localizations.sorted())"
        )
    }
}
