import Foundation
import OpenAPIRuntime

import CountryFlagsDomain

/// The account's own endpoints: identities, devices, exports and deletion.
///
/// Separate from `AuthService`, which is about becoming signed in. This one is
/// only ever called by an account that already is, and two of its operations —
/// the export request and the deletion — carry a fresh proof the caller
/// obtained a moment earlier.
public struct AccountService: AccountDirectory, DataExporting, AccountDeleting {
    private let clientFactory: APIClientFactory
    private let archives: any DataExportArchiveFetching
    private let logger: any AppLogging

    public init(
        clientFactory: APIClientFactory,
        archives: any DataExportArchiveFetching = URLSessionArchiveFetcher(),
        logger: any AppLogging = NoOpLogger()
    ) {
        self.clientFactory = clientFactory
        self.archives = archives
        self.logger = logger
    }

    // MARK: - Identities

    public func identities() async throws -> [AccountIdentityRecord] {
        let output: Operations.listIdentities.Output
        do {
            output = try await clientFactory.makeClient().listIdentities()
        } catch {
            throw APIError.from(error).presentable
        }
        guard case .ok(let response) = output else { return [] }
        return try response.body.json.items.compactMap(Self.identity)
    }

    /// Links another way in. No proof is asked for: the credential the provider
    /// just issued is itself the evidence, which is what the contract says by
    /// requiring only the session here.
    public func link(_ credential: ProviderCredential) async throws -> AccountIdentityRecord {
        let client = clientFactory.makeClient()
        do {
            switch credential {
            case .apple(let identityToken, let authorizationCode, let rawNonce):
                let output = try await client.linkAppleIdentity(
                    body: .json(
                        .init(
                            identityToken: identityToken,
                            authorizationCode: authorizationCode,
                            rawNonce: rawNonce
                        )
                    )
                )
                guard case .created(let response) = output else { throw Self.unexpected }
                return try Self.identity(from: response.body.json) ?? { throw Self.unexpected }()
            case .google(let idToken):
                let output = try await client.linkGoogleIdentity(
                    body: .json(.init(idToken: idToken))
                )
                guard case .created(let response) = output else { throw Self.unexpected }
                return try Self.identity(from: response.body.json) ?? { throw Self.unexpected }()
            }
        } catch {
            throw APIError.from(error).presentable
        }
    }

    public func unlink(_ provider: AuthProvider) async throws {
        do {
            let output = try await clientFactory.makeClient().unlinkIdentity(
                path: .init(provider: provider == .apple ? .APPLE : .GOOGLE)
            )
            guard case .noContent = output else { throw Self.unexpected }
        } catch {
            throw APIError.from(error).presentable
        }
    }

    // MARK: - Devices

    public func devices() async throws -> [AccountDeviceRecord] {
        let output: Operations.listDevices.Output
        do {
            output = try await clientFactory.makeClient().listDevices()
        } catch {
            throw APIError.from(error).presentable
        }
        guard case .ok(let response) = output else { return [] }
        return try response.body.json.items.compactMap(Self.device)
    }

    public func revokeDevice(id: UUID) async throws {
        do {
            let output = try await clientFactory.makeClient().deleteDevice(
                path: .init(deviceId: id.uuidString)
            )
            guard case .noContent = output else { throw Self.unexpected }
        } catch {
            throw APIError.from(error).presentable
        }
    }

    // MARK: - Export

    public func requestExport(
        provingWith proof: ReauthenticationProof?
    ) async throws -> DataExportRecord {
        let output: Operations.createDataExport.Output
        do {
            let client = proof.map { clientFactory.makeClient(proving: $0) }
                ?? clientFactory.makeClient()
            output = try await client.createDataExport()
        } catch {
            throw APIError.from(error).presentable
        }
        guard case .accepted(let response) = output else { throw Self.unexpected }
        return try Self.export(from: response.body.json)
    }

    public func exportStatus(id: UUID) async throws -> DataExportRecord {
        let output: Operations.getDataExport.Output
        do {
            output = try await clientFactory.makeClient().getDataExport(
                path: .init(exportId: id.uuidString)
            )
        } catch {
            throw APIError.from(error).presentable
        }
        guard case .ok(let response) = output else { throw Self.unexpected }
        return try Self.export(from: response.body.json)
    }

    /// The URL is the backend's, complete with the proof in its query string,
    /// so it is fetched rather than rebuilt — and it never reaches a log.
    public func downloadArchive(from url: URL) async throws -> Data {
        try await archives.archive(at: url)
    }

    // MARK: - Deletion

    public func deleteAccount(
        provingWith proof: ReauthenticationProof
    ) async throws -> AccountDeletionRecord {
        let output: Operations.deleteMe.Output
        do {
            output = try await clientFactory.makeClient(proving: proof).deleteMe()
        } catch {
            throw APIError.from(error).presentable
        }
        guard case .accepted(let response) = output else { throw Self.unexpected }
        let payload = try response.body.json
        logger.log(.notice, .auth, "The backend accepted an account deletion")
        return AccountDeletionRecord(
            requestedAt: payload.requestedAt,
            expectedCompletionAt: payload.expectedCompletionAt
        )
    }

    // MARK: - Mapping

    private static var unexpected: APIError {
        APIError.status(
            APIErrorDetails(
                statusCode: 0,
                code: "UNKNOWN",
                message: "Unmapped account response",
                requestID: nil
            )
        )
    }

    private static func identity(
        from payload: Components.Schemas.AuthIdentity
    ) -> AccountIdentityRecord? {
        guard let id = UUID(uuidString: payload.id),
            let provider = AuthProvider(rawValue: payload.provider.rawValue)
        else {
            // A provider this build does not know is left out rather than
            // guessed at: an unknown row the screen cannot name, and must not
            // offer to unlink.
            return nil
        }
        return AccountIdentityRecord(
            id: id,
            provider: provider,
            createdAt: payload.createdAt,
            lastLoginAt: payload.lastLoginAt
        )
    }

    private static func device(
        from payload: Components.Schemas.Device
    ) -> AccountDeviceRecord? {
        guard let id = UUID(uuidString: payload.id) else { return nil }
        return AccountDeviceRecord(
            id: id,
            platform: payload.platform.rawValue,
            appVersion: payload.appVersion,
            locale: payload.locale,
            timezone: payload.timezone,
            lastSeenAt: payload.lastSeenAt,
            isCurrent: payload.current
        )
    }

    private static func export(
        from payload: Components.Schemas.DataExport
    ) throws -> DataExportRecord {
        guard let id = UUID(uuidString: payload.id) else {
            throw APIError.decoding("The export names an identifier this client cannot read")
        }
        guard let status = DataExportStatus(rawValue: payload.status.rawValue) else {
            // A status this build does not know is not something to present as
            // ready or as failed; the caller sees the refusal instead.
            throw APIError.decoding("The export reports a status this client cannot read")
        }
        return DataExportRecord(
            id: id,
            status: status,
            downloadURL: payload.downloadUrl.flatMap(URL.init(string:)),
            sha256: payload.sha256,
            expiresAt: payload.expiresAt,
            createdAt: payload.createdAt,
            completedAt: payload.completedAt
        )
    }
}

/// Fetches the export archive from the URL the backend handed out.
///
/// A seam rather than a direct `URLSession` call, for two reasons: the Mock
/// build has no server to fetch from, and a test must be able to prove what the
/// download did without a socket.
public protocol DataExportArchiveFetching: Sendable {
    func archive(at url: URL) async throws -> Data
}

/// The real fetcher.
///
/// The URL carries a single-use proof in its query string, so nothing here
/// logs it, and the response is not cached: an archive left in a URL cache
/// would outlive the short life the backend gave it.
public struct URLSessionArchiveFetcher: DataExportArchiveFetching {
    private let timeout: TimeInterval

    public init(timeout: TimeInterval = 60) {
        self.timeout = timeout
    }

    public func archive(at url: URL) async throws -> Data {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = timeout
        let session = URLSession(configuration: configuration)
        defer { session.finishTasksAndInvalidate() }

        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport("The export download produced no response")
        }
        guard (200..<300).contains(http.statusCode) else {
            // The status alone: the body of a refused download may name the
            // export, and the URL may not be repeated anywhere.
            throw APIError.status(
                APIErrorDetails(
                    statusCode: http.statusCode,
                    code: "EXPORT_DOWNLOAD_FAILED",
                    message: "The export could not be downloaded",
                    requestID: nil
                )
            )
        }
        return data
    }
}
