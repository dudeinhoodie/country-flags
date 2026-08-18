import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

final class RuntimeConfigurationLoaderTests: XCTestCase {
    func testLoadsConfiguredEnvironment() throws {
        let configuration = try RuntimeConfigurationLoader.configuration(from: [
            RuntimeConfigurationLoader.environmentKey: "dev",
            RuntimeConfigurationLoader.apiBaseURLKey: "https://dev.example.test",
            RuntimeConfigurationLoader.deepLinkSchemeKey: "countryflags",
        ])

        XCTAssertEqual(configuration.environment, .dev)
        XCTAssertEqual(configuration.apiBaseURL, URL(string: "https://dev.example.test"))
        XCTAssertEqual(configuration.deepLinkScheme, "countryflags")
    }

    func testMockRunsWithoutBackendURL() throws {
        let configuration = try RuntimeConfigurationLoader.configuration(from: [
            RuntimeConfigurationLoader.environmentKey: "mock",
            RuntimeConfigurationLoader.apiBaseURLKey: "",
            RuntimeConfigurationLoader.deepLinkSchemeKey: "countryflags",
        ])

        XCTAssertEqual(configuration.environment, .mock)
        XCTAssertNil(configuration.apiBaseURL)
    }

    /// The legal documents are not written yet, so every committed
    /// configuration leaves their addresses empty — and an empty address is an
    /// absent link rather than a broken build.
    func testLegalLinksAreAbsentUntilTheyAreConfigured() throws {
        let configuration = try RuntimeConfigurationLoader.configuration(from: [
            RuntimeConfigurationLoader.environmentKey: "dev",
            RuntimeConfigurationLoader.apiBaseURLKey: "https://dev.example.test",
            RuntimeConfigurationLoader.deepLinkSchemeKey: "countryflags",
            RuntimeConfigurationLoader.privacyPolicyURLKey: "",
            RuntimeConfigurationLoader.termsURLKey: "",
        ])

        XCTAssertNil(configuration.privacyPolicyURL)
        XCTAssertNil(configuration.termsURL)
    }

    func testConfiguredLegalLinksAreRead() throws {
        let configuration = try RuntimeConfigurationLoader.configuration(from: [
            RuntimeConfigurationLoader.environmentKey: "prod",
            RuntimeConfigurationLoader.apiBaseURLKey: "https://api.example.test",
            RuntimeConfigurationLoader.deepLinkSchemeKey: "countryflags",
            RuntimeConfigurationLoader.privacyPolicyURLKey: "https://example.test/privacy",
            RuntimeConfigurationLoader.termsURLKey: "https://example.test/terms",
        ])

        XCTAssertEqual(configuration.privacyPolicyURL, URL(string: "https://example.test/privacy"))
        XCTAssertEqual(configuration.termsURL, URL(string: "https://example.test/terms"))
    }

    /// An address that was configured and cannot be opened is a mistake in the
    /// build rather than a document nobody wrote.
    func testAnUnreadableLegalLinkFailsTheLoad() {
        XCTAssertThrowsError(
            try RuntimeConfigurationLoader.configuration(from: [
                RuntimeConfigurationLoader.environmentKey: "prod",
                RuntimeConfigurationLoader.apiBaseURLKey: "https://api.example.test",
                RuntimeConfigurationLoader.deepLinkSchemeKey: "countryflags",
                RuntimeConfigurationLoader.privacyPolicyURLKey: "example.test/privacy",
            ])
        ) { error in
            XCTAssertEqual(
                error as? RuntimeConfigurationLoader.LoadError,
                .invalidURL("example.test/privacy")
            )
        }
    }

    /// An unknown value must never silently become production.
    func testRejectsUnknownEnvironment() {
        XCTAssertThrowsError(
            try RuntimeConfigurationLoader.configuration(from: [
                RuntimeConfigurationLoader.environmentKey: "staging",
                RuntimeConfigurationLoader.apiBaseURLKey: "https://example.test",
                RuntimeConfigurationLoader.deepLinkSchemeKey: "countryflags",
            ])
        ) { error in
            XCTAssertEqual(
                error as? RuntimeConfigurationLoader.LoadError,
                .unknownEnvironment("staging")
            )
        }
    }

    func testRejectsIncompleteConfiguration() {
        XCTAssertThrowsError(
            try RuntimeConfigurationLoader.configuration(from: [:])
        ) { error in
            XCTAssertEqual(
                error as? RuntimeConfigurationLoader.LoadError,
                .missingKey(RuntimeConfigurationLoader.environmentKey)
            )
        }

        // Dev and Prod without a base URL are a configuration error, not a
        // client that quietly does nothing.
        XCTAssertThrowsError(
            try RuntimeConfigurationLoader.configuration(from: [
                RuntimeConfigurationLoader.environmentKey: "prod",
                RuntimeConfigurationLoader.apiBaseURLKey: "",
                RuntimeConfigurationLoader.deepLinkSchemeKey: "countryflags",
            ])
        ) { error in
            XCTAssertEqual(
                error as? RuntimeConfigurationLoader.LoadError,
                .missingKey(RuntimeConfigurationLoader.apiBaseURLKey)
            )
        }

        XCTAssertThrowsError(
            try RuntimeConfigurationLoader.configuration(from: [
                RuntimeConfigurationLoader.environmentKey: "prod",
                RuntimeConfigurationLoader.apiBaseURLKey: "not a url",
                RuntimeConfigurationLoader.deepLinkSchemeKey: "countryflags",
            ])
        ) { error in
            XCTAssertEqual(
                error as? RuntimeConfigurationLoader.LoadError,
                .invalidURL("not a url")
            )
        }
    }
}
