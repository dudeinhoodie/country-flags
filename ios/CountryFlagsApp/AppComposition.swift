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

        let apiClientFactory = APIClientFactory(
            configuration: APIClientConfiguration(
                baseURL: configuration.apiBaseURL ?? Self.mockBaseURL,
                appVersion: Self.appVersion(from: bundle),
                locale: Self.locale()
            ),
            // Mock answers registered payloads only and never opens a socket,
            // so that configuration is reproducible offline.
            transport: mockTransport(for: configuration, dates: dates),
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
        let tokens = KeychainTokenStore()

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
            scopes: accountScopes(tokens: tokens, identifiers: identifiers, logger: logger),
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
            "getAppConfig": MockAppConfig.response(now: dates.now())
        ]
        // A UI test needs a launch where content requests fail while the store
        // is intact, which is the only way to prove that a relaunch without a
        // network still shows what was downloaded. An unregistered operation
        // fails loudly, so this is a refusal rather than an empty success.
        if !ProcessInfo.processInfo.arguments.contains(offlineContentArgument) {
            fallbacks.merge(MockContent.responses(now: dates.now())) { current, _ in current }
        }
        return MockClientTransport(fallbacks: fallbacks)
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

    /// Mock serves its flags from memory so the configuration stays reproducible
    /// with no network at all; every other environment downloads them.
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
