import Foundation
import SwiftUI
import UIKit

import CountryFlagsDomain
import CountryFlagsFeatures
import CountryFlagsInfrastructure
// For the one type the release build has to name where the mock transport
// would otherwise stand: the absence of a transport.
import OpenAPIRuntime

#if DEBUG
    // The canned backend, linked only where it is used. A release build
    // never names it, so the linker never pulls the module in.
    import CountryFlagsMockBackend
#endif

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
    /// The one progress store in the app. Every screen that shows a count
    /// reads this instance, so the same deck cannot be worth two numbers.
    var progress: ProgressStore { get }
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
    let progress: ProgressStore
    let assets: any AssetLoading
    let scopes: any AccountScopeResolving
    /// The session behind `scopes`, for the account surface that signs in
    /// and out of it.
    let sessions: SessionCoordinator
    let guestMigrations: GuestMigrationCoordinator
    let studySessions: StudySessionService
    let settingsSync: any SettingsSyncing
    /// The preferences of this run, held once. See `makeSettingsStore()`.
    let settings: SettingsStore
    let progressClearing: any ProgressClearing
    /// Identities, devices, the export and the deletion: one service, and
    /// the only caller is the account screen.
    let accountService: AccountService
    let sync: SyncCenter
    let advertising: any AdvertisingProviding
    let analytics: any AnalyticsTracking
    /// The live analytics queue behind `analytics`, kept because the privacy
    /// screen has to hand it a consent decision and the sync has to flush it.
    let analyticsCoordinator: AnalyticsCoordinator
    let diagnosticsCoordinator: DiagnosticsCoordinator
    let telemetryContexts: TelemetryContextProvider
    let privacySync: any PrivacySettingsSyncing
    /// Held for the lifetime of the app: MetricKit keeps its subscribers
    /// weakly, so nobody else holding this means nobody is listening.
    let metricKitSubscriber: MetricKitSubscriber
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
            baseURL: Self.baseURL(for: configuration),
            appVersion: Self.appVersion(from: bundle),
            locale: Self.locale()
        )
        // Mock answers registered payloads only and never opens a socket, so
        // that configuration is reproducible offline. One transport serves
        // both factories below: the Mock one records requests, and two
        // recorders would each see half a conversation. A release build has no
        // mock transport to ask for, and therefore no mock backend linked in.
        #if DEBUG
            let transport = mockTransport(for: configuration, dates: dates)
        #else
            let transport: (any ClientTransport)? = nil
        #endif

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
        let authService = AuthService(
            clientFactory: authClientFactory,
            devices: InstallationDeviceRegistration(
                tokens: tokens,
                identifiers: identifiers,
                appVersion: Self.appVersion(from: bundle)
            )
        )
        let sessions = SessionCoordinator(
            service: authService,
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
        // The scale of the screen this app is running on, read once at
        // assembly: it decides which raster every asset record points at, and
        // it cannot change under a running app.
        let contentService = ContentService(
            clientFactory: apiClientFactory,
            dates: dates,
            displayScale: Double(UITraitCollection.current.displayScale)
        )
        let coordinator = ContentBootstrapCoordinator(
            service: contentService,
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
        // Telemetry is assembled before the services that report through it.
        // Consent starts at "nobody has been asked", which collects nothing
        // optional; the privacy screen loads the stored answer and applies it.
        let telemetryService = TelemetryService(clientFactory: apiClientFactory, logger: logger)
        let telemetryContexts = TelemetryContextProvider(
            identityStore: UserDefaultsTelemetryIdentityStore(),
            identifiers: identifiers,
            appVersion: Self.appVersion(from: bundle),
            build: Self.buildNumber(from: bundle),
            locale: Self.locale()
        )
        let unaskedConsent = TelemetryConsent.unasked(
            policyVersion: PrivacyStore.policyVersion,
            now: dates.now()
        )
        let analyticsCoordinator = AnalyticsCoordinator(
            repository: store.makeTelemetryRepository(),
            scopes: sessions,
            contexts: telemetryContexts,
            sender: telemetryService,
            consent: unaskedConsent,
            identifiers: identifiers,
            dates: dates,
            logger: logger
        )
        let diagnosticsCoordinator = DiagnosticsCoordinator(
            repository: store.makeTelemetryRepository(),
            scopes: sessions,
            uploader: telemetryService,
            consent: unaskedConsent,
            appVersion: Self.appVersion(from: bundle),
            build: Self.buildNumber(from: bundle),
            identifiers: identifiers,
            dates: dates,
            logger: logger
        )

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
            progressDownload: progressService,
            userChanges: UserChangesService(clientFactory: apiClientFactory),
            dates: dates,
            logger: logger
        )

        // Built here rather than per screen: the counts belong to the app,
        // and four screens each building their own is how the same deck came
        // to be worth different numbers in different places.
        let progress = makeProgressStore(store: store, scopes: sessions, dates: dates)
        let sync = SyncCenter(
            coordinator: syncCoordinator,
            scopes: sessions,
            analytics: analyticsCoordinator,
            dates: dates,
            reachability: NetworkReachabilityMonitor()
        )
        // The single "the numbers changed" signal: a run finishes, the store
        // re-reads, every screen observing it moves. No screen decides for
        // itself when that moment is.
        MainActor.assumeIsolated { sync.observe(progress) }

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
                analytics: analyticsCoordinator,
                dates: dates,
                // The bootstrap imports cards without their entities — only
                // the change feed carries those — so the first ask for an
                // official name goes to the API once and is stored like
                // everything else on screen.
                fetchEntity: { id, locale in
                    guard let entity = try? await contentService.entity(id: id, locale: locale)
                    else { return nil }
                    if let manifest = try? await contentRepository.currentManifest() {
                        try? await contentRepository.applyStagedPage(
                            ContentPage(entities: [entity]),
                            staging: ContentStagingState(
                                contentVersion: manifest.contentVersion,
                                stage: .ready,
                                cursor: nil,
                                pendingDeckIDs: [],
                                updatedAt: dates.now()
                            )
                        )
                    }
                    return entity
                }
            ),
            progress: progress,
            assets: assetCache,
            // Who the repositories write as: the session when somebody signed
            // in, the guest otherwise. One answer for the whole app.
            scopes: sessions,
            sessions: sessions,
            guestMigrations: guestMigrations,
            studySessions: studySessions,
            settingsSync: progressService,
            settings: SettingsStore(
                learning: store.makeLearningRepository(),
                scopes: sessions,
                sync: progressService,
                reminders: UserNotificationReminderScheduler(logger: logger),
                // The hour lives beside the app's other device preferences:
                // it is a property of this phone, not of the account.
                reminderPreferences: UserDefaultsReminderPreferenceStore(),
                dates: dates
            ),
            progressClearing: progressService,
            accountService: AccountService(
                clientFactory: apiClientFactory,
                archives: exportArchiveFetcher(for: configuration),
                logger: logger
            ),
            sync: sync,
            // Advertising is off in the MVP: no SDK is linked and nothing is
            // initialized. The boundary exists so that changing it later is a
            // composition change rather than a change to every screen.
            advertising: NoOpAdvertisingProvider(),
            analytics: analyticsCoordinator,
            analyticsCoordinator: analyticsCoordinator,
            diagnosticsCoordinator: diagnosticsCoordinator,
            telemetryContexts: telemetryContexts,
            privacySync: telemetryService,
            metricKitSubscriber: MetricKitSubscriber(
                coordinator: diagnosticsCoordinator,
                dates: dates
            ),
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
    static func makeProgressStore(
        store: LocalStore,
        scopes: any AccountScopeResolving,
        dates: any DateProviding
    ) -> ProgressStore {
        ProgressStore(
            content: store.makeContentRepository(),
            learning: store.makeLearningRepository(),
            scopes: scopes,
            dates: dates
        )
    }

    func makeAccountStore() -> AccountStore {
        let store = AccountStore(
            session: sessions,
            migrations: guestMigrations,
            outbox: store.makeOutboxRepository(),
            scopes: scopes,
            nonces: SystemNonceGenerator(),
            deletionState: UserDefaultsAccountDeletionStateStore(),
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
            allowsFakeSignIn: Self.allowsFixtureCredentials(configuration),
            analytics: analytics,
            dates: dates,
            logger: logger
        )
        store.onSignedIn = { [sync] in
            await sync.synchronize(trigger: .signedIn)
        }
        return store
    }

    /// The account screen's dependencies. The session, the scope cleaner and
    /// the deletion notice are wired together here because the order they
    /// happen in — server first, then this device's data, then the tokens —
    /// is the store's business and nobody else's.
    func makeAccountLifecycleStore() -> AccountLifecycleStore {
        let account = AccountLifecycleStore(
            deleting: accountService,
            session: sessions,
            scopes: scopes,
            cleaner: store.makeAccountScopeCleaner(),
            deletionState: UserDefaultsAccountDeletionStateStore(),
            logger: logger
        )
        account.onSignedOut = { [router] in
            // A deletion ended the session; the screen it happened on is
            // about an account that is no longer there.
            await MainActor.run { router.popToRoot() }
        }
        return account
    }

    /// The privacy screen's dependencies. Both collectors are handed to it,
    /// so one decision reaches everything that collects under it.
    func makePrivacyStore() -> PrivacyStore {
        PrivacyStore(
            repository: store.makeTelemetryRepository(),
            scopes: scopes,
            collectors: [analyticsCoordinator, diagnosticsCoordinator],
            sync: privacySync,
            dates: dates
        )
    }

    /// The one settings store of the run.
    ///
    /// It used to build a fresh one per screen, which was harmless while only
    /// the settings screen read them: each instance loaded the same record
    /// and converged. It stopped being harmless when the session started
    /// reading the haptics preference — a toggle flipped on one instance is
    /// invisible to another until it reloads, so a switch turned off would
    /// have kept buzzing until the app was relaunched.
    func makeSettingsStore() -> SettingsStore { settings }

    /// Whether this run may stand a fixture credential in for a provider sheet.
    private static func allowsFixtureCredentials(_ configuration: RuntimeConfiguration) -> Bool {
        configuration.environment.allowsDebugAffordances
            && ProcessInfo.processInfo.arguments.contains("-fake-signin")
    }

    /// Clearing progress is assembled per visit like every other store.
    func makeClearProgressStore() -> ClearProgressStore {
        let clearProgress = ClearProgressStore(
            clearing: progressClearing,
            learning: store.makeLearningRepository(),
            outbox: store.makeOutboxRepository(),
            scopes: scopes,
            logger: logger
        )
        clearProgress.onCleared = { [sync] in
            // The account's stream was rotated by the deletion, so the next run
            // reads it from the beginning: the device converges on the empty
            // history rather than waiting for a foreground to find out.
            await sync.synchronize(trigger: .pullToRefresh)
        }
        return clearProgress
    }

    func makeObjectiveSessionRunner() -> ObjectiveSessionRunner {
        ObjectiveSessionRunner(
            scopes: scopes,
            content: store.makeContentRepository(),
            learning: store.makeLearningRepository(),
            analytics: analytics,
            errors: errorReporter,
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
            outbox: store.makeOutboxRepository(),
            analytics: analytics,
            errors: errorReporter,
            dates: dates,
            identifiers: identifiers
        )
    }

    /// Each configuration keeps its own file, so running the Mock build does
    /// not overwrite the progress made against a real backend.
    private static func storeName(for configuration: RuntimeConfiguration) -> String {
        "CountryFlags-\(configuration.environment.rawValue)"
    }

    /// The mock backend, wrapped in `#if DEBUG` for a reason the App Store
    /// cares about: the package it lives in is built in release for every
    /// configuration, so a reference from here is what decides whether the
    /// linker pulls its canned payloads — and the string "mock.invalid" —
    /// into the binary that ships. Mock and Dev define DEBUG; Prod does not.
    #if DEBUG
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
                // The account surface: its ways in, its devices, an export that is
                // ready by the time it is asked about, and a deletion that is
                // accepted. All of it offline.
                "listIdentities": MockAccount.identities(now: dates.now()),
                "unlinkIdentity": MockAccount.unlinked,
                "listDevices": MockAccount.devices(now: dates.now()),
                "deleteDevice": MockAccount.deviceRevoked,
                "createDataExport": MockAccount.exportRequested(now: dates.now()),
                "getDataExport": MockAccount.exportReady(now: dates.now()),
                "deleteMe": MockAccount.deletionAccepted(now: dates.now()),
                "reauthenticateApple": MockAuth.reauthenticationProof(now: dates.now()),
                "reauthenticateGoogle": MockAuth.reauthenticationProof(now: dates.now()),
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
    #endif

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

    /// Mock has no server to fetch an archive from, so it answers with one of
    /// its own: the export flow is then walkable offline, end to end, which is
    /// the only way a UI test can drive it at all. A release build downloads,
    /// full stop — there is no mock module in it to ask.
    private static func exportArchiveFetcher(
        for configuration: RuntimeConfiguration
    ) -> any DataExportArchiveFetching {
        #if DEBUG
            if configuration.environment == .mock {
                return MockExportArchiveFetcher()
            }
        #endif
        return URLSessionArchiveFetcher()
    }

    /// Mock ships the release it serves, so it hosts no assets at all and a
    /// download would mean the bundled baseline missed; every other environment
    /// downloads them.
    private static func assetFetcher(
        for configuration: RuntimeConfiguration
    ) -> any AssetDataFetching {
        #if DEBUG
            if configuration.environment == .mock {
                return MockAssetFetcher()
            }
        #endif
        return URLSessionAssetFetcher()
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
            // The store is not the only thing a launch remembers: the deletion
            // notice deliberately lives outside it, so a reset that left it
            // standing would hand the next test somebody else's account state.
            UserDefaultsAccountDeletionStateStore().store(pendingDeletion: nil)
        }
    #endif

    #if DEBUG
        /// The Mock configuration has no backend. The URL is never dialed; it
        /// only satisfies the client, which requires a server URL.
        private static let mockBaseURL = URL(string: "https://mock.invalid")!
    #endif

    /// Where this build talks to.
    ///
    /// The placeholder is a debug-only thing now. It used to be the fallback in
    /// every configuration, which put the string "mock.invalid" inside the
    /// binary that goes to the App Store — and, worse, gave a release build
    /// with a missing endpoint somewhere harmless-looking to point at instead
    /// of failing. A release build without an endpoint is a broken build.
    private static func baseURL(for configuration: RuntimeConfiguration) -> URL {
        if let url = configuration.apiBaseURL {
            return url
        }
        #if DEBUG
            return mockBaseURL
        #else
            fatalError("CFAPIBaseURL is missing from the Info.plist of a release build")
        #endif
    }

    private static func appVersion(from bundle: Bundle) -> String {
        bundle.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }

    /// The build the event envelope's context names, beside the version.
    private static func buildNumber(from bundle: Bundle) -> String {
        bundle.infoDictionary?["CFBundleVersion"] as? String ?? "0"
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
