import XCTest

@testable import CountryFlagsDomain

final class DeepLinkParserTests: XCTestCase {
    private let parser = DeepLinkParser(scheme: "countryflags")

    func testParsesEverySupportedRoute() throws {
        let deckId = try XCTUnwrap(UUID(uuidString: "70000000-0000-4000-8000-000000000001"))

        XCTAssertEqual(route("countryflags://catalog"), .catalog)
        XCTAssertEqual(route("countryflags://progress"), .progress)
        XCTAssertEqual(route("countryflags://settings"), .settings)
        XCTAssertEqual(route("countryflags://deck/\(deckId.uuidString)"), .deck(id: deckId))
    }

    func testIgnoresAnotherScheme() {
        XCTAssertNil(route("https://catalog"))
        XCTAssertNil(route("otherapp://catalog"))
    }

    func testAcceptsSchemeCaseInsensitively() {
        XCTAssertEqual(route("CountryFlags://Catalog"), .catalog)
    }

    func testRejectsMalformedRoutes() {
        XCTAssertNil(route("countryflags://deck"))
        XCTAssertNil(route("countryflags://deck/not-a-uuid"))
        XCTAssertNil(route("countryflags://deck/\(UUID().uuidString)/extra"))
        XCTAssertNil(route("countryflags://catalog/extra"))
        XCTAssertNil(route("countryflags://unknown"))
    }

    private func route(_ string: String) -> AppRoute? {
        guard let url = URL(string: string) else {
            return nil
        }
        return parser.route(for: url)
    }
}

final class SystemDependenciesTests: XCTestCase {
    /// Тест обязан уметь подменить часы и генератор идентификаторов.
    func testDependenciesAreSubstitutable() {
        let instant = Date(timeIntervalSince1970: 1_760_000_000)
        let identifier = UUID()
        let date: DateProviding = FixedDateProvider(instant: instant)
        let identifiers: IdentifierProviding = FixedIdentifierProvider(identifier: identifier)

        XCTAssertEqual(date.now(), instant)
        XCTAssertEqual(identifiers.next(), identifier)
    }

    func testEnvironmentHidesDebugAffordancesInProduction() {
        XCTAssertFalse(AppEnvironment.prod.allowsDebugAffordances)
        XCTAssertTrue(AppEnvironment.dev.allowsDebugAffordances)
        XCTAssertTrue(AppEnvironment.mock.allowsDebugAffordances)
    }
}

private struct FixedDateProvider: DateProviding {
    let instant: Date

    func now() -> Date { instant }
}

private struct FixedIdentifierProvider: IdentifierProviding {
    let identifier: UUID

    func next() -> UUID { identifier }
}
