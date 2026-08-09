import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

final class ContentServiceTests: XCTestCase {
    private let locale = "ru"

    // MARK: - Manifest

    func testTheManifestIsMappedOntoAStoredRecord() async throws {
        let transport = MockClientTransport()
        await transport.always(
            MockContent.manifestResponse(now: ContentTestClient.now),
            for: "getContentManifest"
        )

        let result = try await ContentTestClient.makeService(transport: transport)
            .manifest(locale: locale)

        guard case .updated(let fetch) = result else {
            return XCTFail("Expected an updated manifest, got \(result)")
        }
        XCTAssertEqual(fetch.manifest.contentVersion, MockContent.contentVersion)
        XCTAssertEqual(fetch.manifest.defaultLocale, "en")
        XCTAssertEqual(fetch.manifest.supportedLocales, ["en", "ru"])
        XCTAssertEqual(fetch.manifest.supportedTemplateSchemaVersions, [1])
        XCTAssertEqual(fetch.manifest.changeCursor, MockContent.changeCursor)
        XCTAssertEqual(fetch.minimumClientVersion, MockContent.minimumClientVersion)
        XCTAssertEqual(fetch.entityTag, MockContent.entityTag)
        // The manifest is applied now, not when the release was published.
        XCTAssertEqual(fetch.manifest.appliedAt, ContentTestClient.now)
    }

    /// The no-change case: an unchanged release costs a status line and no body.
    func testAnUnchangedManifestIsReportedAsNotModified() async throws {
        let transport = MockClientTransport()
        await transport.always(.init(statusCode: 304), for: "getContentManifest")

        let result = try await ContentTestClient.makeService(transport: transport)
            .manifest(locale: locale, entityTag: MockContent.entityTag)

        guard case .notModified = result else {
            return XCTFail("Expected notModified, got \(result)")
        }
        let requests = await transport.requests(for: "getContentManifest")
        XCTAssertEqual(requests.first?.header("if-none-match"), MockContent.entityTag)
    }

    // MARK: - Decks

    func testDecksAreMappedFromTheCanonicalFixture() async throws {
        let transport = MockClientTransport()
        await transport.always(try ContractFixture.response("decks.json"), for: "listDecks")

        let page = try await ContentTestClient.makeService(transport: transport)
            .decks(locale: locale)

        XCTAssertEqual(page.items.map(\.code), ["ALL_COUNTRIES", "EUROPE"])
        XCTAssertEqual(page.items.first?.name, "Все страны")
        XCTAssertEqual(page.items.first?.cardCount, 8)
        XCTAssertEqual(page.items.map(\.sortOrder), [0, 1])
        XCTAssertFalse(page.hasMore)
        XCTAssertNil(page.nextCursor)
    }

    /// Without an offset a second page would number its decks from zero and
    /// sort into the first one.
    func testASecondPageContinuesTheOrder() async throws {
        let transport = MockClientTransport()
        await transport.always(try ContractFixture.response("decks.json"), for: "listDecks")

        let page = try await ContentTestClient.makeService(transport: transport)
            .decks(locale: locale, cursor: "opaque", sortOffset: 40)

        XCTAssertEqual(page.items.map(\.sortOrder), [40, 41])
    }

    // MARK: - Cards

    func testCardsCarryTheirPromptAssetAndDeckMembership() async throws {
        let transport = MockClientTransport()
        await transport.always(try ContractFixture.response("deck-cards.json"), for: "listDeckCards")
        let deckID = UUID(uuidString: "70000000-0000-4000-8000-000000000002")!

        let page = try await ContentTestClient.makeService(transport: transport)
            .cards(inDeck: deckID, locale: locale, supportedTemplateSchemaVersions: [1])

        XCTAssertEqual(page.cards.map(\.displayName), ["Косово"])
        XCTAssertEqual(page.cards.first?.aliases, ["Kosovo"])
        XCTAssertEqual(page.deckCards.map(\.deckID), [deckID])
        XCTAssertEqual(page.assets.count, 1)
        XCTAssertEqual(page.assets.first?.id, page.cards.first?.promptAssetID)
        XCTAssertEqual(page.assets.first?.mimeType, "image/svg+xml")
        XCTAssertEqual(page.assets.first?.sha256.count, 64)
        XCTAssertTrue(page.hasMore)
        XCTAssertNotNil(page.nextCursor)
        XCTAssertTrue(page.unsupportedCardIDs.isEmpty)
    }

    /// One card built on a template this build cannot draw must not empty the
    /// deck around it.
    func testACardOnAnUnsupportedTemplateIsSkippedNotFatal() async throws {
        let transport = MockClientTransport()
        await transport.always(try ContractFixture.response("deck-cards.json"), for: "listDeckCards")

        let page = try await ContentTestClient.makeService(transport: transport)
            .cards(
                inDeck: UUID(),
                locale: locale,
                // The release declares support for template 2 only; the fixture
                // card is built on template 1.
                supportedTemplateSchemaVersions: [2]
            )

        XCTAssertTrue(page.cards.isEmpty)
        XCTAssertTrue(page.assets.isEmpty)
        XCTAssertEqual(page.unsupportedCardIDs.count, 1)
        // The page itself still parsed, so paging continues past it.
        XCTAssertTrue(page.hasMore)
    }

    // MARK: - Changes

    func testTheChangeFeedIsSortedIntoUpsertsAndTombstones() async throws {
        let transport = MockClientTransport()
        await transport.always(
            try ContractFixture.response("content-changes.json"),
            for: "getContentChanges"
        )

        let batch = try await ContentTestClient.makeService(transport: transport)
            .changes(after: "cursor", locale: locale)

        XCTAssertEqual(
            batch.upsertedEntityIDs.map { $0.uuidString.lowercased() },
            ["30000000-0000-4000-8000-000000000005"]
        )
        XCTAssertEqual(
            batch.retiredCardIDs.map { $0.uuidString.lowercased() },
            ["50000000-0000-4000-8000-000000000007"]
        )
        XCTAssertTrue(batch.retiredEntityIDs.isEmpty)
        XCTAssertFalse(batch.hasMore)
        XCTAssertEqual(batch.contentVersion, "test-only-fixture-v2")
    }

    /// A feed that grew a resource type this build does not apply must not stop
    /// the ones it does. The contract ships a fixture for exactly this.
    func testAnUnknownResourceTypeIsCountedNotFatal() async throws {
        let transport = MockClientTransport()
        await transport.always(
            try ContractFixture.response("content-changes-unknown-resource.json"),
            for: "getContentChanges"
        )

        let batch = try await ContentTestClient.makeService(transport: transport)
            .changes(after: "cursor", locale: locale)

        XCTAssertEqual(batch.ignoredResourceTypes, ["CARD_TEMPLATE"])
        XCTAssertEqual(batch.upsertedEntityIDs.count, 1)
        XCTAssertEqual(batch.retiredCardIDs.count, 1)
    }

    // MARK: - Entities

    func testAnEntityCarriesTheLocaleItWasRequestedIn() async throws {
        let transport = MockClientTransport()
        await transport.always(try ContractFixture.response("entity.json"), for: "getEntity")

        let entity = try await ContentTestClient.makeService(transport: transport)
            .entity(id: UUID(uuidString: "30000000-0000-4000-8000-000000000005")!, locale: "ru")

        let entity_ = try XCTUnwrap(entity)
        // The backend localizes per request, so the stored name is tagged with
        // the locale that was asked for rather than guessed.
        XCTAssertEqual(entity_.names.first?.locale, "ru")
        XCTAssertTrue(entity_.names.first?.isPrimary ?? false)
        XCTAssertFalse(entity_.names.first?.value.isEmpty ?? true)
    }

    /// The contract uses 404 for content hidden from the catalog, and the
    /// matching tombstone is what removes it locally. A miss is not an error.
    func testAHiddenEntityIsNotAnError() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .errorEnvelope(statusCode: 404, code: "NOT_FOUND"),
            for: "getEntity"
        )

        let entity = try await ContentTestClient.makeService(transport: transport)
            .entity(id: UUID(), locale: locale)

        XCTAssertNil(entity)
    }
}
