import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure
import CountryFlagsMockBackend

/// The account's endpoints as they go on the wire: what is sent, what is
/// carried with it, and what a refusal turns into by the time a screen sees it.
final class AccountServiceTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    // MARK: - Identities

    func testIdentitiesAreMappedFromTheContractsShape() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .json(
                """
                {"items":[{"id":"a0000000-0000-4000-8000-000000000001",\
                "provider":"APPLE","createdAt":"2027-01-15T08:00:00Z",\
                "lastLoginAt":"2027-01-15T08:00:00Z"}]}
                """
            ),
            for: "listIdentities"
        )

        let identities = try await makeService(transport: transport).identities()

        XCTAssertEqual(identities.map(\.provider), [.apple])
        XCTAssertEqual(identities.first?.lastLoginAt, now)
    }

    /// An identity the client cannot address is left out rather than shown
    /// with a made-up identifier: the row would offer to unlink something the
    /// request could never name.
    ///
    /// The provider itself is a closed enum in the contract, so an unknown one
    /// is a contract violation rather than a row to skip — the decoder refuses
    /// the whole response, which is the honest outcome and not this test's.
    func testAnIdentityWithAnUnreadableIdentifierIsLeftOut() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .json(
                """
                {"items":[{"id":"a0000000-0000-4000-8000-000000000001",\
                "provider":"APPLE","createdAt":"2027-01-15T08:00:00Z",\
                "lastLoginAt":"2027-01-15T08:00:00Z"},\
                {"id":"not-a-uuid","provider":"GOOGLE",\
                "createdAt":"2027-01-15T08:00:00Z",\
                "lastLoginAt":"2027-01-15T08:00:00Z"}]}
                """
            ),
            for: "listIdentities"
        )

        let identities = try await makeService(transport: transport).identities()

        XCTAssertEqual(identities.map(\.provider), [.apple])
    }

    func testUnlinkingNamesTheProviderInThePath() async throws {
        let transport = MockClientTransport()
        await transport.always(.init(statusCode: 204), for: "unlinkIdentity")

        try await makeService(transport: transport).unlink(.google)

        let requests = await transport.requests(for: "unlinkIdentity")
        XCTAssertEqual(requests.first?.method, "DELETE")
        XCTAssertEqual(requests.first?.path, "/v1/me/identities/GOOGLE")
    }

    /// The refusal a screen has to act on arrives as a code, never as the
    /// server's sentence.
    func testAConflictReachesTheCallerAsAPresentableCode() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .errorEnvelope(
                statusCode: 409,
                code: "IDENTITY_ALREADY_LINKED",
                message: "This provider identity is already linked to another account"
            ),
            for: "linkGoogleIdentity"
        )

        do {
            _ = try await makeService(transport: transport).link(.google(idToken: "token"))
            XCTFail("Expected the conflict to be thrown")
        } catch let error as PresentableError {
            XCTAssertEqual(error.kind, .conflict)
            XCTAssertEqual(error.code, "IDENTITY_ALREADY_LINKED")
        }
    }

    // MARK: - Devices

    func testDevicesCarryWhichOneIsCurrent() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .json(
                """
                {"items":[{"id":"d0000000-0000-4000-8000-000000000001",\
                "platform":"IOS","appVersion":"1.0.0","locale":"en","timezone":"UTC",\
                "lastSeenAt":"2027-01-15T08:00:00Z","current":true}]}
                """
            ),
            for: "listDevices"
        )

        let devices = try await makeService(transport: transport).devices()

        XCTAssertEqual(devices.map(\.isCurrent), [true])
        XCTAssertEqual(devices.first?.appVersion, "1.0.0")
    }

    // MARK: - Export

    /// The request is one of the two operations that carry a fresh proof.
    func testRequestingAnExportCarriesTheProof() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .json(
                """
                {"id":"e0000000-0000-4000-8000-000000000001","status":"PENDING",\
                "downloadUrl":null,"sha256":null,"expiresAt":null,\
                "createdAt":"2027-01-15T08:00:00Z","completedAt":null}
                """,
                statusCode: 202
            ),
            for: "createDataExport"
        )

        let export = try await makeService(transport: transport)
            .requestExport(provingWith: ReauthenticationProof(token: "proof-1", expiresAt: now))

        XCTAssertEqual(export.status, .pending)
        let requests = await transport.requests(for: "createDataExport")
        XCTAssertEqual(requests.first?.header("x-reauthentication-token"), "proof-1")
    }

    /// Reading the status needs no proof: it carries nothing the account holder
    /// has not already been shown.
    func testReadingTheExportStatusCarriesNoProof() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .json(
                """
                {"id":"e0000000-0000-4000-8000-000000000001","status":"READY",\
                "downloadUrl":"https://example.invalid/download?token=abc",\
                "sha256":null,"expiresAt":"2027-01-15T08:15:00Z",\
                "createdAt":"2027-01-15T08:00:00Z","completedAt":"2027-01-15T08:00:00Z"}
                """
            ),
            for: "getDataExport"
        )

        let export = try await makeService(transport: transport)
            .exportStatus(id: UUID(uuidString: "e0000000-0000-4000-8000-000000000001")!)

        XCTAssertEqual(export.status, .ready)
        XCTAssertNotNil(export.downloadURL)
        let requests = await transport.requests(for: "getDataExport")
        XCTAssertNil(requests.first?.header("x-reauthentication-token"))
    }

    /// A status this build does not know is refused rather than read as ready:
    /// the caller is about to hand somebody their whole account.
    func testAnUnknownExportStatusIsRefused() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .json(
                """
                {"id":"e0000000-0000-4000-8000-000000000001","status":"SHREDDED",\
                "downloadUrl":null,"sha256":null,"expiresAt":null,\
                "createdAt":"2027-01-15T08:00:00Z","completedAt":null}
                """
            ),
            for: "getDataExport"
        )

        do {
            _ = try await makeService(transport: transport)
                .exportStatus(id: UUID(uuidString: "e0000000-0000-4000-8000-000000000001")!)
            XCTFail("Expected the unknown status to be refused")
        } catch {
            // Any refusal will do; what must not happen is a `.ready` export.
        }
    }

    /// The archive is fetched from the URL the backend handed out, through the
    /// seam that keeps it out of the client's own logging.
    func testTheArchiveIsFetchedFromTheBackendsOwnURL() async throws {
        let fetcher = RecordingArchiveFetcher(data: Data("{}".utf8))
        let service = makeService(transport: MockClientTransport(), archives: fetcher)
        let url = URL(string: "https://example.invalid/download?token=abc")!

        let data = try await service.downloadArchive(from: url)

        XCTAssertEqual(data, Data("{}".utf8))
        let fetched = await fetcher.fetchedURLs()
        XCTAssertEqual(fetched, [url])
    }

    // MARK: - Deletion

    func testDeletingTheAccountCarriesTheProofAndReportsTheDate() async throws {
        let transport = MockClientTransport()
        await transport.always(
            .json(
                """
                {"status":"DELETION_PENDING","requestedAt":"2027-01-15T08:00:00Z",\
                "expectedCompletionAt":"2027-01-22T08:00:00Z"}
                """,
                statusCode: 202
            ),
            for: "deleteMe"
        )

        let deletion = try await makeService(transport: transport)
            .deleteAccount(provingWith: ReauthenticationProof(token: "proof-2", expiresAt: now))

        XCTAssertEqual(deletion.requestedAt, now)
        XCTAssertEqual(deletion.expectedCompletionAt, now.addingTimeInterval(7 * 86_400))
        let requests = await transport.requests(for: "deleteMe")
        XCTAssertEqual(requests.first?.header("x-reauthentication-token"), "proof-2")
    }

    // MARK: - Harness

    private func makeService(
        transport: MockClientTransport,
        archives: any DataExportArchiveFetching = RecordingArchiveFetcher(data: Data())
    ) -> AccountService {
        AccountService(
            clientFactory: APIClientFactory(
                configuration: APITestClient.configuration,
                transport: transport,
                identifiers: SequentialIdentifierProvider(),
                retryPolicy: RetryPolicy(maximumAttempts: 1),
                scheduler: RecordingBackoffScheduler(),
                jitter: ZeroJitterProvider()
            ),
            archives: archives
        )
    }
}

// MARK: - Doubles

private actor RecordingArchiveFetcher: DataExportArchiveFetching {
    private let data: Data
    private var urls: [URL] = []

    init(data: Data) {
        self.data = data
    }

    func fetchedURLs() -> [URL] { urls }

    func archive(at url: URL) async throws -> Data {
        urls.append(url)
        return data
    }
}
