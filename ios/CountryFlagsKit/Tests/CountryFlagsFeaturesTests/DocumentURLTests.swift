import XCTest

@testable import CountryFlagsFeatures

final class DocumentURLTests: XCTestCase {
    private let privacy = URL(string: "https://site.example/privacy")!

    func testTheAppLanguageTravelsAsAQueryParameter() {
        XCTAssertEqual(
            DocumentURL.localized(privacy, language: "ru").absoluteString,
            "https://site.example/privacy?lang=ru"
        )
    }

    /// The site addresses a document by language alone, so a regional
    /// localization is reduced to its language before it is sent.
    func testARegionalLocalizationIsSentAsItsLanguage() {
        XCTAssertEqual(DocumentURL.baseLanguage(of: "ru-RU"), "ru")
        XCTAssertEqual(DocumentURL.baseLanguage(of: "ru_RU"), "ru")
        XCTAssertEqual(DocumentURL.baseLanguage(of: "en-GB"), "en")
        XCTAssertEqual(DocumentURL.baseLanguage(of: "EN"), "en")
        XCTAssertEqual(
            DocumentURL.localized(privacy, language: "ru-RU").absoluteString,
            "https://site.example/privacy?lang=ru"
        )
    }

    /// A configured address that already says a language is corrected, not
    /// doubled, and whatever else it carried is kept.
    func testAnExistingLanguageParameterIsReplaced() {
        let configured = URL(string: "https://site.example/privacy?lang=en&ref=app")!
        XCTAssertEqual(
            DocumentURL.localized(configured, language: "ru").absoluteString,
            "https://site.example/privacy?ref=app&lang=ru"
        )
    }

    func testNoLanguageLeavesTheAddressAlone() {
        XCTAssertEqual(DocumentURL.localized(privacy, language: nil), privacy)
        XCTAssertEqual(DocumentURL.localized(privacy, language: ""), privacy)
        XCTAssertNil(DocumentURL.baseLanguage(of: nil))
    }
}
