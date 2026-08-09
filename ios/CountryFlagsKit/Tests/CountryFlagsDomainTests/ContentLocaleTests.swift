import XCTest

@testable import CountryFlagsDomain

final class ContentLocaleResolverTests: XCTestCase {
    private let supported = ["en", "ru"]

    func testAnExactMatchWins() {
        let resolution = ContentLocaleResolver(preferredLanguages: ["ru", "en"])
            .resolve(supported: supported, default: "en")

        XCTAssertEqual(resolution.locale, "ru")
        XCTAssertEqual(resolution.matched, .exact)
        XCTAssertFalse(resolution.isFallback)
    }

    /// A device set to Russian (Russia) is reading the same language as one set
    /// to plain Russian, so it gets the release rather than the default.
    func testARegionalVariantIsServedByItsLanguage() {
        let resolution = ContentLocaleResolver(preferredLanguages: ["ru-RU"])
            .resolve(supported: supported, default: "en")

        XCTAssertEqual(resolution.locale, "ru")
        XCTAssertEqual(resolution.matched, .language)
        XCTAssertFalse(resolution.isFallback)
    }

    /// `Locale.identifier` produces the underscore form, and it reaches here
    /// whenever a caller forwards a system value without converting it.
    func testTheUnderscoreFormIsUnderstood() {
        let resolution = ContentLocaleResolver(preferredLanguages: ["ru_RU"])
            .resolve(supported: supported, default: "en")

        XCTAssertEqual(resolution.locale, "ru")
        XCTAssertEqual(resolution.matched, .language)
    }

    func testTheOrderOfPreferredLanguagesIsHonoured() {
        let resolution = ContentLocaleResolver(preferredLanguages: ["de", "ru", "en"])
            .resolve(supported: supported, default: "en")

        XCTAssertEqual(resolution.locale, "ru")
    }

    /// An exact match anywhere in the preference list beats a language-only
    /// match earlier in it: "ru" published exactly is closer than "en" reached
    /// through "en-GB".
    func testAnExactMatchBeatsAnEarlierLanguageMatch() {
        let resolution = ContentLocaleResolver(preferredLanguages: ["en-GB", "ru"])
            .resolve(supported: supported, default: "en")

        XCTAssertEqual(resolution.locale, "ru")
        XCTAssertEqual(resolution.matched, .exact)
    }

    /// The documented fallback: nothing the device asked for is published, so
    /// the manifest's default is used and the UI is allowed to say so.
    func testAnUnpublishedLanguageFallsBackToTheManifestDefault() {
        let resolution = ContentLocaleResolver(preferredLanguages: ["ja", "ko"])
            .resolve(supported: supported, default: "en")

        XCTAssertEqual(resolution.locale, "en")
        XCTAssertEqual(resolution.matched, .fallback)
        XCTAssertTrue(resolution.isFallback)
    }

    func testADeviceWithNoPreferencesFallsBack() {
        let resolution = ContentLocaleResolver(preferredLanguages: [])
            .resolve(supported: supported, default: "en")

        XCTAssertEqual(resolution.locale, "en")
        XCTAssertTrue(resolution.isFallback)
    }
}

final class LocalizedNameSelectionTests: XCTestCase {
    private let names = [
        GeoNameRecord(locale: "en", value: "France", isPrimary: true),
        GeoNameRecord(locale: "ru", value: "Франция", isPrimary: false),
    ]

    func testTheRequestedLocaleWins() {
        XCTAssertEqual(
            LocalizedNameSelection.name(from: names, locale: "ru", default: "en"),
            "Франция"
        )
    }

    func testARegionalVariantResolvesThroughItsLanguage() {
        XCTAssertEqual(
            LocalizedNameSelection.name(from: names, locale: "ru-RU", default: "en"),
            "Франция"
        )
    }

    func testAnUnknownLocaleFallsBackToTheDefault() {
        XCTAssertEqual(
            LocalizedNameSelection.name(from: names, locale: "ja", default: "en"),
            "France"
        )
    }

    /// The primary name is the one the pipeline marks canonical, so it beats
    /// whichever locale happens to sort first.
    func testWithoutTheDefaultThePrimaryNameIsUsed() {
        let names = [
            GeoNameRecord(locale: "de", value: "Frankreich", isPrimary: false),
            GeoNameRecord(locale: "fr", value: "France", isPrimary: true),
        ]

        XCTAssertEqual(
            LocalizedNameSelection.name(from: names, locale: "ja", default: "en"),
            "France"
        )
    }

    func testAnEntityWithNoNamesHasNone() {
        XCTAssertNil(LocalizedNameSelection.name(from: [], locale: "en", default: "en"))
    }
}
