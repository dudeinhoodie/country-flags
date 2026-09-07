import Foundation
import OpenAPIRuntime

import CountryFlagsDomain

/// The account's store token, read from the profile and remembered for as long
/// as that account is the one signed in.
///
/// The token is minted by the backend and says nothing to the store. What it
/// buys is attribution without a session: Apple signs it into the transaction,
/// and a notification that arrives with no request of ours behind it — a
/// refund, an Ask to Buy approved days later, a purchase restored on another
/// device — is matched back to this account by the token alone. Without it the
/// backend can still attribute a purchase, but only once the client gets
/// around to submitting the transaction itself.
///
/// An unreachable backend answers `nil` rather than throwing. `nil` is the
/// honest answer to "which account is this", and `PurchaseCoordinator`
/// attaches the option only when the token is known: a fabricated one would
/// name the wrong account, which is worse than naming none.
///
/// **Held in memory rather than in the keychain, deliberately.** A stored
/// token would have to be cleared on sign-out, and a missed clear means the
/// previous account's token riding on the next account's purchase — the same
/// shape of bug as a refund landing a grant on a deleted account. Here the
/// scope is the key, so signing out cannot leave a stale answer behind: a
/// different account is a different key, and a guest is never asked. The cost
/// is one request per launch, on the first purchase of that launch.
public actor StoreAccountTokenProvider: StoreAccountTokenProviding {
    private let clientFactory: APIClientFactory
    private let scopes: any AccountScopeResolving
    private let logger: any AppLogging

    /// What the profile answered, per account.
    ///
    /// The value is itself optional, and that is the point: an account the
    /// backend says has no token is a settled answer, not a missing one, and
    /// must not be asked again on every purchase.
    private var answered: [AccountScope: UUID?] = [:]

    public init(
        clientFactory: APIClientFactory,
        scopes: any AccountScopeResolving,
        logger: any AppLogging = NoOpLogger()
    ) {
        self.clientFactory = clientFactory
        self.scopes = scopes
        self.logger = logger
    }

    public func storeAccountToken() async -> UUID? {
        let scope = await scopes.currentScope()
        // A guest owns nothing and buys nothing, and `GET /v1/me` would refuse
        // the request anyway. Asking would be a round trip to be told so.
        guard !scope.isGuest else { return nil }
        if let remembered = answered[scope] {
            return remembered
        }
        do {
            let token = try await profileToken()
            answered[scope] = token
            return token
        } catch {
            // Not remembered: a request the radio dropped is not an account
            // without a token, and the next purchase should ask again.
            logger.log(
                .notice,
                .commerce,
                "The account's store token could not be read; the purchase will carry none"
            )
            return nil
        }
    }

    private func profileToken() async throws -> UUID? {
        let client = clientFactory.makeClient()
        let output: Operations.getMe.Output
        do {
            output = try await client.getMe()
        } catch {
            throw APIError.from(error)
        }
        switch output {
        case .ok(let response):
            let payload = try response.body.json
            // A value that is not a UUID is a contract the backend broke, and
            // reading it as "no token" is the safe half of that mistake.
            return payload.storeAccountToken.flatMap { UUID(uuidString: $0) }
        default:
            throw APIError.status(
                APIErrorDetails(
                    statusCode: 0,
                    code: "UNKNOWN",
                    message: "Unmapped profile response",
                    requestID: nil
                )
            )
        }
    }
}
