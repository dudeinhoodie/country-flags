import Foundation
import OpenAPIRuntime

import CountryFlagsDomain

/// Exchanges provider credentials for a backend session, and rotates it.
///
/// The credentials pass through and are never held: what comes back is the only
/// thing the app keeps, and even that goes to the keychain rather than to any
/// store a log or a backup can read.
public struct AuthService: AuthenticationService {
    private let clientFactory: APIClientFactory
    private let devices: any DeviceRegistrationProviding

    public init(clientFactory: APIClientFactory, devices: any DeviceRegistrationProviding) {
        self.clientFactory = clientFactory
        self.devices = devices
    }

    public func exchange(_ credential: ProviderCredential) async throws -> AuthSessionRecord {
        let client = clientFactory.makeClient()
        let device = Self.registration(await devices.registration())
        do {
            switch credential {
            case .apple(let identityToken, let authorizationCode, let rawNonce):
                let output = try await client.authenticateWithApple(
                    body: .json(
                        .init(
                            identityToken: identityToken,
                            authorizationCode: authorizationCode,
                            rawNonce: rawNonce,
                            device: device
                        )
                    )
                )
                guard case .ok(let response) = output else { throw Self.unexpected }
                return try Self.session(from: response.body.json)
            case .google(let idToken):
                let output = try await client.authenticateWithGoogle(
                    body: .json(.init(idToken: idToken, device: device))
                )
                guard case .ok(let response) = output else { throw Self.unexpected }
                return try Self.session(from: response.body.json)
            }
        } catch {
            throw APIError.from(error)
        }
    }

    public func refresh(refreshToken: String) async throws -> RefreshedSessionRecord {
        let client = clientFactory.makeClient()
        do {
            let output = try await client.refreshSession(
                body: .json(.init(refreshToken: refreshToken))
            )
            guard case .ok(let response) = output else { throw Self.unexpected }
            let tokens = try response.body.json
            return RefreshedSessionRecord(
                accessToken: tokens.accessToken,
                accessTokenExpiresAt: tokens.accessTokenExpiresAt,
                refreshToken: tokens.refreshToken
            )
        } catch {
            throw APIError.from(error)
        }
    }

    public func logout(refreshToken: String) async throws {
        let client = clientFactory.makeClient()
        do {
            _ = try await client.logout(body: .json(.init(refreshToken: refreshToken)))
        } catch {
            throw APIError.from(error)
        }
    }

    public func logoutEverywhere() async throws {
        let client = clientFactory.makeClient()
        do {
            _ = try await client.logoutAll()
        } catch {
            throw APIError.from(error)
        }
    }

    private static var unexpected: APIError {
        // Unreachable in practice: the error middleware turns every status at
        // or above 400 into an `APIError` before the generated client parses
        // it. Handled rather than ignored so a contract change cannot quietly
        // produce a success here.
        APIError.status(
            APIErrorDetails(
                statusCode: 0,
                code: "UNKNOWN",
                message: "Unmapped authentication response",
                requestID: nil
            )
        )
    }

    /// The generated DTO stays inside this target: a caller describes its
    /// device in domain terms and never learns what the wire looks like.
    private static func registration(
        _ record: DeviceRegistrationRecord
    ) -> Components.Schemas.DeviceRegistration {
        .init(
            clientGeneratedId: record.clientGeneratedID,
            platform: .IOS,
            appVersion: record.appVersion,
            locale: record.locale,
            timezone: record.timezone
        )
    }

    private static func session(
        from payload: Components.Schemas.AuthSession
    ) throws -> AuthSessionRecord {
        guard let userID = UUID(uuidString: payload.user.id) else {
            throw APIError.decoding("The session names a user this client cannot read")
        }
        return AuthSessionRecord(
            userID: userID,
            displayName: payload.user.displayName,
            accessToken: payload.tokens.accessToken,
            accessTokenExpiresAt: payload.tokens.accessTokenExpiresAt,
            refreshToken: payload.tokens.refreshToken
        )
    }
}


