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

final class APITransportTests: XCTestCase {
    /// Until IOS-002 the transport has to say honestly that it is not built.
    func testUnconfiguredTransportFailsInsteadOfFakingSuccess() async {
        let transport: APITransport = UnconfiguredAPITransport()

        do {
            _ = try await transport.send(APIRequest(path: "/v1/app-config"))
            XCTFail("Unconfigured transport must not return a response")
        } catch {
            XCTAssertEqual(error as? APITransportError, .notConfigured)
        }
    }

    func testMockTransportAnswersOnlyRegisteredRequests() async throws {
        let request = APIRequest(path: "/v1/app-config")
        let expected = APIResponse(statusCode: 200, body: Data("{}".utf8))
        let transport: APITransport = MockAPITransport(responses: [request: expected])

        let response = try await transport.send(request)
        XCTAssertEqual(response, expected)

        let unknown = APIRequest(path: "/v1/decks")
        do {
            _ = try await transport.send(unknown)
            XCTFail("Mock transport must not invent a response")
        } catch {
            XCTAssertEqual(error as? APITransportError, .unhandled(unknown))
        }
    }
}
