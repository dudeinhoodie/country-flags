import Foundation
import OpenAPIURLSession

// The same import the generated client uses: `UniversalClient` — the layer the
// generated operations are built on — lives behind this SPI, and one endpoint
// here has to reach it. See `makeUniversalClient()` for why.
@_spi(Generated) import OpenAPIRuntime

import CountryFlagsDomain

/// Builds the configured API client.
///
/// The generated `Client` and its DTOs stay internal to this module: feature
/// code receives domain models and `APIError`, so a contract change cannot
/// ripple into the UI layer by accident.
public struct APIClientFactory: Sendable {
    private let configuration: APIClientConfiguration
    private let transport: any ClientTransport
    private let tokens: any AuthorizationTokenProviding
    private let identifiers: any IdentifierProviding
    private let logger: any APIRequestLogging
    private let retryPolicy: RetryPolicy
    private let scheduler: any BackoffScheduling
    private let jitter: any JitterProviding

    /// - Parameter transport: defaults to URLSession. The Mock configuration
    ///   and the tests pass `MockClientTransport` instead, which is why the
    ///   transport is a parameter rather than a build-time condition.
    public init(
        configuration: APIClientConfiguration,
        transport: (any ClientTransport)? = nil,
        tokens: any AuthorizationTokenProviding = GuestTokenProvider(),
        identifiers: any IdentifierProviding = SystemIdentifierProvider(),
        logger: any APIRequestLogging = OSLogAPIRequestLogger(),
        retryPolicy: RetryPolicy = RetryPolicy(),
        scheduler: any BackoffScheduling = TaskBackoffScheduler(),
        jitter: any JitterProviding = RandomJitterProvider()
    ) {
        self.configuration = configuration
        self.transport = transport
            ?? Self.makeURLSessionTransport(timeout: configuration.requestTimeout)
        self.tokens = tokens
        self.identifiers = identifiers
        self.logger = logger
        self.retryPolicy = retryPolicy
        self.scheduler = scheduler
        self.jitter = jitter
    }

    /// The transport used unless a caller supplies one, such as the Mock build
    /// configuration or a test.
    public static func makeURLSessionTransport(
        timeout: Duration
    ) -> any ClientTransport {
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.timeoutIntervalForRequest = TimeInterval(
            timeout.components.seconds
        )
        // The client is the only source of truth for freshness; a URL cache
        // would serve stale content behind the ETag handling of the contract.
        sessionConfiguration.requestCachePolicy = .reloadIgnoringLocalCacheData
        sessionConfiguration.urlCache = nil
        return URLSessionTransport(
            configuration: .init(session: URLSession(configuration: sessionConfiguration))
        )
    }

    /// Repositories that need generated operations live in this module and use
    /// this client; nothing outside the module can reach the DTOs.
    func makeClient() -> Client {
        Client(
            serverURL: configuration.baseURL,
            configuration: Configuration(dateTranscoder: FractionalSecondsDateTranscoder()),
            transport: transport,
            middlewares: middlewares
        )
    }

    /// The same transport, middlewares and configuration, addressed one level
    /// lower than the generated operations.
    ///
    /// One endpoint needs it: the analytics batch. Its canonical schema types a
    /// property as any of string, number, integer or boolean, and the generator
    /// cannot express that union — it emits `[String: String]`, which would
    /// send `10` as `"10"` and be refused by the backend's own registry check.
    /// The body is therefore serialized from the domain envelope, which mirrors
    /// `contracts/schemas/analytics/batch.v1.schema.json` exactly, and still
    /// travels through authentication, logging, retry and error mapping.
    func makeUniversalClient() -> UniversalClient {
        UniversalClient(
            serverURL: configuration.baseURL,
            configuration: Configuration(dateTranscoder: FractionalSecondsDateTranscoder()),
            transport: transport,
            middlewares: middlewares
        )
    }

    /// A client that also carries a fresh reauthentication proof.
    ///
    /// The proof is a security scheme rather than a parameter, so no generated
    /// operation has a place to put it; a middleware on a client built for one
    /// operation does. Built per call and thrown away with the proof, which is
    /// what keeps it from reaching an operation nobody re-authenticated for.
    func makeClient(proving proof: ReauthenticationProof) -> Client {
        Client(
            serverURL: configuration.baseURL,
            configuration: Configuration(dateTranscoder: FractionalSecondsDateTranscoder()),
            transport: transport,
            middlewares: [ReauthenticationMiddleware(token: proof.token)] + middlewares
        )
    }

    /// Outermost first.
    ///
    /// The context middleware runs first so one logical request carries one
    /// request identifier: every attempt of it correlates with the same server
    /// log entry, and the identifier is available to the logger below it. The
    /// entity tag is repaired next, above retry, so it is decoded once rather
    /// than once per attempt. Logging then records the outcome once. Error
    /// mapping sits above retry and refresh so both still work with real status
    /// codes, and the authentication middleware is innermost because the token
    /// it attaches changes between attempts.
    var middlewares: [any ClientMiddleware] {
        [
            ClientContextMiddleware(
                configuration: configuration,
                identifiers: identifiers
            ),
            ConditionalRequestMiddleware(),
            LoggingMiddleware(logger: logger),
            ErrorMappingMiddleware(),
            RetryMiddleware(policy: retryPolicy, scheduler: scheduler, jitter: jitter),
            AuthenticationMiddleware(
                tokens: tokens,
                refreshCoordinator: TokenRefreshCoordinator(provider: tokens)
            ),
        ]
    }
}
