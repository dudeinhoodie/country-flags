import Foundation

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// Builds a content service wired to the mock transport.
enum ContentTestClient {
    static func makeService(
        transport: MockClientTransport,
        dates: any DateProviding = FixedDateProvider(instant: ContentTestClient.now)
    ) -> ContentService {
        ContentService(
            clientFactory: APIClientFactory(
                configuration: APITestClient.configuration,
                transport: transport,
                identifiers: SequentialIdentifierProvider(),
                retryPolicy: RetryPolicy(maximumAttempts: 1),
                scheduler: RecordingBackoffScheduler(),
                jitter: ZeroJitterProvider()
            ),
            dates: dates
        )
    }

    static let now = Date(timeIntervalSince1970: 1_800_000_000)
}

/// The canonical fixtures the backend is verified against.
///
/// They are read from the repository rather than copied into the test bundle,
/// for the reason `FeatureFlagRegistryParityTests` already gives: a mirror is
/// one more thing that can go stale.
enum ContractFixture {
    static func json(_ name: String) throws -> String {
        let url = repositoryRoot.appending(path: "contracts/fixtures/openapi/\(name)")
        return try String(contentsOf: url, encoding: .utf8)
    }

    static func response(_ name: String, statusCode: Int = 200) throws -> MockClientTransport.Response {
        .json(try json(name), statusCode: statusCode)
    }

    /// This file sits at `ios/CountryFlagsKit/Tests/CountryFlagsInfrastructureTests/`.
    private static let repositoryRoot: URL = URL(filePath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
}

/// Serves registered bytes and counts what was asked for, so a cache test can
/// prove a second read did not reach the network.
actor RecordingAssetFetcher: AssetDataFetching {
    private var bytes: [URL: Data]
    private var failures: Set<URL>
    private(set) var requestedURLs: [URL] = []

    init(bytes: [URL: Data] = [:], failures: Set<URL> = []) {
        self.bytes = bytes
        self.failures = failures
    }

    func data(from url: URL) async throws -> Data {
        requestedURLs.append(url)
        if failures.contains(url) {
            throw APIError.transport("unreachable")
        }
        guard let data = bytes[url] else {
            throw APIError.transport("nothing registered")
        }
        return data
    }

    func requests() -> [URL] { requestedURLs }
}
