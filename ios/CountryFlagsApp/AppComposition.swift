import Foundation
import SwiftUI

import CountryFlagsDomain
import CountryFlagsFeatures
import CountryFlagsInfrastructure

/// The dependency set of the app.
///
/// The protocol names what later work packages extend (storage, feature flags)
/// while the concrete instance stays substitutable: a test assembles its own
/// container without touching global state.
@MainActor
protocol AppDependencies {
    var configuration: RuntimeConfiguration { get }
    var router: AppRouter { get }
    var deepLinkParser: DeepLinkParser { get }
    var apiClientFactory: APIClientFactory { get }
    var store: LocalStore { get }
    var tokens: any SecureTokenStoring { get }
    var dates: DateProviding { get }
    var identifiers: IdentifierProviding { get }
    var featureFlags: FeatureFlagCenter { get }
    var content: ContentStore { get }
    var assets: any AssetLoading { get }
    var scopes: any AccountScopeResolving { get }
    var sync: SyncCenter { get }
    var advertising: any AdvertisingProviding { get }
    var analytics: any AnalyticsTracking { get }
    var errorReporter: any ErrorReporting { get }
    var diagnostics: any DiagnosticsReporting { get }
    var logger: any AppLogging { get }
}

@MainActor
struct AppComposition: AppDependencies {
    let configuration: RuntimeConfiguration
    let router: AppRouter
    let deepLinkParser: DeepLinkParser
    let apiClientFactory: APIClientFactory
    let store: LocalStore
    let tokens: any SecureTokenStoring
    let dates: DateProviding
    let identifiers: IdentifierProviding
    let featureFlags: FeatureFlagCenter
    let content: ContentStore
    let assets: any AssetLoading
    let scopes: any AccountScopeResolving
    /// The session behind `scopes`, for the account surface that signs in
    /// and out of it.
    let sessions: SessionCoordinator
    let guestMigrations: GuestMigrationCoordinator
    let studySessions: StudySessionService
    let settingsSync: any SettingsSyncing
    let sync: SyncCenter
    let advertising: any AdvertisingProviding
    let analytics: any AnalyticsTracking
    let errorReporter: any ErrorReporting
    let diagnostics: any DiagnosticsReporting
    let logger: any AppLogging

    /// The layers below `FeatureFlagCenter`, kept so the launch sequence can
    /// drive them. Nothing else reaches for them.
    private let flagClient: OpenFeatureFlagClient
    private let activatedFlags: ActivatedFeatureFlags

    static func live(bundle: Bundle = .main) -> AppComposition {
        let configuration: RuntimeConfiguration
        do {
            configuration = try RuntimeConfigurationLoader.configuration(from: bundle)
        } catch {
            // A build without a valid xcconfig cannot work: failing here is
            // cheaper than an app that silently runs against an unknown
            // environment.
            fatalError("Invalid build configuration: \(error)")
        }

        let identifiers = SystemIdentifierProvider()
        let dates = SystemDateProvider()
        let logger = OSLogAppLogger()
        let name = storeName(for: configuration)
        #if DEBUG
            // Before the store is opened, so a UI test starts from a known
            // empty state. Only Mock and Dev define DEBUG; a release binary
            // does not contain this call at all.
            resetStoreIfRequested(name: name)
        #endif

        let store: LocalStore
        do {
            store = try LocalStore(location: .onDisk(name: name))
        } catch {
            // The store holds reviews that have not reached the backend.
            // Continuing with a fresh one would discard them without telling
            // anyone; failing loudly keeps the file intact for a later build.
            fatalError("The local store is unavailable: \(error)")
        }

        let apiConfiguration = APIClientConfiguration(
            baseURL: configuration.apiBaseURL ?? Self.mockBaseURL,
            appVersion: Self.appVersion(from: bundle),
            locale: Self.locale()
        )
        // Mock answers registered payloads only and never opens a socket, so
        // that configuration is reproducible offline. One transport serves
        // both factories below: the Mock one records requests, and two
        // recorders would each see half a conversation.
        let transport = mockTransport(for: configuration, dates: dates)

        let tokens = KeychainTokenStore()
        let accountScopes = accountScopes(tokens: tokens, identifiers: identifiers, logger: logger)
        // The auth endpoints authenticate by what is in their bodies -- an
        // identity token, a refresh token -- not by a bearer, so their client
        // carries none. That is also what breaks the cycle: the session needs
        // a client, and every other client needs the session.
        let authClientFactory = APIClientFactory(
            configuration: apiConfiguration,
            transport: transport,
            identifiers: identifiers
        )
        let sessions = SessionCoordinator(
            service: AuthService(
                clientFactory: authClientFactory,
                devices: InstallationDeviceRegistration(
                    tokens: tokens,
                    identifiers: identifiers,
                    appVersion: Self.appVersion(from: bundle)
                )
            ),
            tokens: tokens,
            guestScopes: accountScopes,
            logger: logger
        )
        let apiClientFactory = APIClientFactory(
            configuration: apiConfiguration,
            transport: transport,
            tokens: sessions,
            identifiers: identifiers
        )

        // A release build has no override, whatever the launch arguments say:
        // the environment gate is what a local package can follow, since Xcode
        // compiles it in release for every configuration not named "Debug".
        let overrides = FeatureFlagOverrides.fromLaunchArguments(
            ProcessInfo.processInfo.arguments,
            environment: configuration.environment
        )
        let flagClient = OpenFeatureFlagClient(
            service: AppConfigService(clientFactory: apiClientFactory, dates: dates),
            cache: UserDefaultsAppConfigCache(),
            overrides: overrides,
            dates: dates,
            logger: logger
        )
        let activatedFlags = ActivatedFeatureFlags(live: flagClient, dates: dates)

        // Content is shared by every account, so it is wired once here rather
        // than rebuilt whenever the signed-in account changes.
        let assetCache = FileAssetCache(
            directory: FileAssetCache.defaultDirectory(),
            fetcher: assetFetcher(for: configuration),
            logger: logger
        )
        let contentRepository = store.makeContentRepository()
        let coordinator = ContentBootstrapCoordinator(
            service: ContentService(clientFactory: apiClientFactory, dates: dates),
            repository: contentRepository,
            tags: UserDefaultsContentManifestTagStore(),
            dates: dates,
            logger: logger,
            appVersion: Self.appVersion(from: bundle)
        )

        // The guest's work follows its owner: the coordinator reads the guest
        // scope directly -- the session coordinator would already answer with
        // the account -- and archives it only after the backend acknowledged.
        let guestMigrations = GuestMigrationCoordinator(
            guestScopes: accountScopes,
            learning: store.makeLearningRepository(),
            importer: GuestImportService(clientFactory: apiClientFactory),
            records: UserDefaultsGuestMigrationStore(),
            cleaner: store.makeAccountScopeCleaner(),
            dates: dates,
            identifiers: identifiers,
            logger: logger
        )

        // Settings are offered to the server under the version they were read
        // at. A guest never reaches it — the store checks the scope — but the
        // seam is wired now so signing in does not need a composition change.
        let progressService = ProgressService(clientFactory: apiClientFactory, logger: logger)
        // The backend's half of session composition: server selection for a
        // signed-in learner, and the import that walks an offline session to
        // the backend ahead of its reviews.
        let studySessions = StudySessionService(
            clientFactory: apiClientFactory,
            content: contentRepository,
            dates: dates
        )
        // The queue is durable from the first launch. A guest's answers wait
        // — held by scope, attributed to nobody — and start flowing once the
        // account exists and the backend has named this device.
        let syncCoordinator = SyncCoordinator(
            outbox: store.makeOutboxRepository(),
            learning: store.makeLearningRepository(),
            uploader: ReviewUploader(
                clientFactory: apiClientFactory,
                devices: RegisteredDeviceProvider(
                    clientFactory: apiClientFactory,
                    tokens: tokens,
                    scopes: sessions
                ),
                logger: logger
            ),
            sessionImports: studySessions,
            dates: dates,
            logger: logger
        )

        return AppComposition(
            configuration: configuration,
            router: AppRouter(),
            deepLinkParser: DeepLinkParser(scheme: configuration.deepLinkScheme),
            apiClientFactory: apiClientFactory,
            store: store,
            tokens: tokens,
            dates: dates,
            identifiers: identifiers,
            featureFlags: FeatureFlagCenter(flags: activatedFlags),
            content: ContentStore(
                repository: contentRepository,
                coordinator: coordinator,
                dates: dates
            ),
            assets: assetCache,
            // Who the repositories write as: the session when somebody signed
            // in, the guest otherwise. One answer for the whole app.
            scopes: sessions,
            sessions: sessions,
            guestMigrations: guestMigrations,
            studySessions: studySessions,
            settingsSync: progressService,
            sync: SyncCenter(coordinator: syncCoordinator, scopes: sessions),
            // Advertising is off in the MVP: no SDK is linked and nothing is
            // initialized. The boundary exists so that changing it later is a
            // composition change rather than a change to every screen.
            advertising: NoOpAdvertisingProvider(),
            analytics: NoOpAnalyticsTracker(),
            errorReporter: NoOpErrorReporter(),
            diagnostics: NoOpDiagnosticsReporter(),
            logger: logger,
            flagClient: flagClient,
            activatedFlags: activatedFlags
        )
    }

    /// Brings the flags up for the account this device is using.
    ///
    /// It runs after the first frame rather than before it: the cached snapshot
    /// and the bundled defaults already answer every read, so nothing on screen
    /// waits for the network.
    func start() async {
        // Who this launch belongs to is decided first: everything after --
        // the flag context, the sync scope -- reads the answer.
        await sessions.restore()
        let scope = await scopes.currentScope()
        let context = FeatureFlagContext(
            scope: scope,
            environment: configuration.environment,
            appVersion: Self.appVersion(from: .main),
            locale: Self.locale()
        )
        // The cached snapshot first, without the network: from here on every
        // read answers with what the previous run knew.
        await flagClient.activate(context: context)
        // The launch-scoped values are frozen against that, so a `nextLaunch`
        // flag reflects the run it belongs to rather than a value that lands a
        // moment later.
        activatedFlags.freezeLaunchValues()
        await featureFlags.refresh(context: context)
    }

    /// The progress screen owns no state between visits: it reads the store on
    /// appearance, so a session finished a moment ago is already counted.
    func makeProgressStore() -> ProgressStore {
        ProgressStore(
            content: store.makeContentRepository(),
            learning: store.makeLearningRepository(),
            scopes: scopes,
            dates: dates
        )
    }

    func makeAccountStore() -> AccountStore {
        AccountStore(
            session: sessions,
            migrations: guestMigrations,
            outbox: store.makeOutboxRepository(),
            scopes: scopes,
            nonces: SystemNonceGenerator(),
            // No credentials, no button: an offer that cannot finish is worse
            // than no offer.
            google: configuration.googleClientID.map { clientID in
                GoogleSignInAdapter(
                    clientID: clientID,
                    serverClientID: configuration.googleServerClientID
                )
            },
            // Debug environments only, and only when the launch asked for it:
            // a fixture credential must never be one tap away in production.
            allowsFakeSignIn: configuration.environment.allowsDebugAffordances
                && ProcessInfo.processInfo.arguments.contains("-fake-signin"),
            logger: logger
        )
    }

    func makeSettingsStore() -> SettingsStore {
        SettingsStore(
            learning: store.makeLearningRepository(),
            scopes: scopes,
            sync: settingsSync,
            dates: dates
        )
    }

    func makeObjectiveSessionRunner() -> ObjectiveSessionRunner {
        ObjectiveSessionRunner(
            scopes: scopes,
            content: store.makeContentRepository(),
            learning: store.makeLearningRepository(),
            dates: dates,
            identifiers: identifiers
        )
    }

    /// A study session owns its own state, so each one gets a fresh runner
    /// rather than sharing a long-lived object with whatever session ran last.
    ///
    /// The scope is resolved once here: a session belongs to the account that
    /// started it, and it must not change identity halfway through.
    func makeStudySessionRunner() -> StudySessionRunner {
        StudySessionRunner(
            scopes: scopes,
            content: store.makeContentRepository(),
            learning: store.makeLearningRepository(),
            selection: studySessions,
            dates: dates,
            identifiers: identifiers
        )
    }

    /// Each configuration keeps its own file, so running the Mock build does
    /// not overwrite the progress made against a real backend.
    private static func storeName(for configuration: RuntimeConfiguration) -> String {
        "CountryFlags-\(configuration.environment.rawValue)"
    }

    private static func mockTransport(
        for configuration: RuntimeConfiguration,
        dates: any DateProviding
    ) -> MockClientTransport? {
        guard configuration.environment == .mock else { return nil }
        var fallbacks: [String: MockClientTransport.Response] = [
            "getAppConfig": MockAppConfig.response(now: dates.now()),
            // The account surface, offline: exchange, rotation, sign-out and
            // the guest import all answer deterministically.
            "authenticateWithApple": MockAuth.session(now: dates.now()),
            "authenticateWithGoogle": MockAuth.session(now: dates.now()),
            "refreshSession": MockAuth.refreshedTokens(now: dates.now()),
            "logout": MockAuth.loggedOut,
            "logoutAll": MockAuth.loggedOut,
            "createGuestImport": MockAuth.importResult(now: dates.now()),
            "getGuestImport": MockAuth.importResult(now: dates.now(), statusCode: 200),
        ]
        var handlers: [String: MockClientTransport.Handler] = [:]
        // A UI test needs a launch where content requests fail while the store
        // is intact, which is the only way to prove that a relaunch without a
        // network still shows what was downloaded. An unregistered operation
        // fails loudly, so this is a refusal rather than an empty success.
        if !ProcessInfo.processInfo.arguments.contains(offlineContentArgument) {
            fallbacks.merge(MockContent.responses()) { current, _ in current }
            handlers = MockContent.handlers()
        }
        return MockClientTransport(fallbacks: fallbacks, handlers: handlers)
    }

    /// Simulates a launch with no reachable backend. Mock only: every other
    /// configuration talks to a real one.
    static let offlineContentArgument = "-offline-content"

    /// The account this device acts as.
    ///
    /// A guest is identified by an installation identifier in the keychain. A
    /// UI test cannot rely on that surviving a relaunch — an unsigned build has
    /// no keychain entitlement — so a debug build accepts a pinned identifier
    /// and exercises the real resume path with a stable identity. A release
    /// binary does not contain this branch at all.
    private static func accountScopes(
        tokens: any SecureTokenStoring,
        identifiers: any IdentifierProviding,
        logger: any AppLogging
    ) -> any AccountScopeResolving {
        #if DEBUG
            if let pinned = pinnedInstallationID() {
                return FixedAccountScopeResolver(scope: .guest(installationID: pinned))
            }
        #endif
        return GuestScopeProvider(tokens: tokens, identifiers: identifiers, logger: logger)
    }

    #if DEBUG
        static let installationIDArgument = "-installation-id"

        static func pinnedInstallationID(
            arguments: [String] = ProcessInfo.processInfo.arguments
        ) -> UUID? {
            guard let index = arguments.firstIndex(of: installationIDArgument),
                index + 1 < arguments.count
            else {
                return nil
            }
            return UUID(uuidString: arguments[index + 1])
        }
    #endif

    /// Mock ships the release it serves, so it hosts no assets at all and a
    /// download would mean the bundled baseline missed; every other environment
    /// downloads them.
    private static func assetFetcher(
        for configuration: RuntimeConfiguration
    ) -> any AssetDataFetching {
        configuration.environment == .mock ? MockAssetFetcher() : URLSessionAssetFetcher()
    }

    #if DEBUG
        /// UI tests need a known empty store.
        ///
        /// The reset lives in the app target rather than in the package
        /// because Xcode builds a local package in release for every
        /// configuration not named "Debug", so a `#if DEBUG` inside the
        /// package would not follow the app's own Debug flag.
        static let resetStoreArgument = "-reset-store"

        static func resetStoreIfRequested(
            name: String,
            arguments: [String] = ProcessInfo.processInfo.arguments,
            fileManager: FileManager = .default
        ) {
            guard arguments.contains(resetStoreArgument) else { return }
            for url in LocalStore.fileURLs(forName: name) {
                try? fileManager.removeItem(at: url)
            }
        }
    #endif

    /// The Mock configuration has no backend. The URL is never dialed; it only
    /// satisfies the client, which requires a server URL.
    private static let mockBaseURL = URL(string: "https://mock.invalid")!

    private static func appVersion(from bundle: Bundle) -> String {
        bundle.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }

    /// BCP 47, which is what the contract validates. The system identifier uses
    /// an underscore ("en_US") and would be rejected.
    private static func locale() -> String {
        Locale.current.identifier(.bcp47)
    }
}

#if DEBUG
    /// A guest identity a UI test can keep across relaunches.
    struct FixedAccountScopeResolver: AccountScopeResolving {
        let scope: AccountScope

        func currentScope() async -> AccountScope { scope }
    }
#endif
