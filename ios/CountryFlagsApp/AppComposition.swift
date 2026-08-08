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
    var dates: any DateProviding { get }
    var identifiers: any IdentifierProviding { get }
    var logger: any AppLogging { get }
    var featureFlags: FeatureFlagClient { get }
    var advertising: any AdvertisingProviding { get }
    var advertisingPolicy: AdvertisingPolicyStore { get }
    var adEligibility: AdEligibilityService { get }
    var analytics: any AnalyticsTracking { get }
    var errorReporter: any ErrorReporting { get }
    var diagnostics: any DiagnosticsReporting { get }
}

@MainActor
struct AppComposition: AppDependencies {
    let configuration: RuntimeConfiguration
    let router: AppRouter
    let deepLinkParser: DeepLinkParser
    let apiClientFactory: APIClientFactory
    let store: LocalStore
    let tokens: any SecureTokenStoring
    let dates: any DateProviding
    let identifiers: any IdentifierProviding
    let logger: any AppLogging
    let featureFlags: FeatureFlagClient
    /// The only advertising implementation the app ships. No ad SDK is linked,
    /// no App Tracking Transparency prompt exists and no advertising identifier
    /// is read; the boundary is here so a provider can be added later behind an
    /// ADR and a privacy review.
    let advertising: any AdvertisingProviding
    let advertisingPolicy: AdvertisingPolicyStore
    let adEligibility: AdEligibilityService
    /// Telemetry adapters default to doing nothing. They exist so a feature can
    /// report without knowing whether anything is listening, and so that a
    /// missing provider can never fail a study session.
    let analytics: any AnalyticsTracking
    let errorReporter: any ErrorReporting
    let diagnostics: any DiagnosticsReporting

    private let installationScope: InstallationScopeProvider

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

        let logger = OSLogAppLogger(
            minimumLevel: configuration.environment.allowsDebugAffordances
                ? .debug
                : OSLogAppLogger.releaseMinimumLevel
        )
        let apiClientFactory = APIClientFactory(
            configuration: APIClientConfiguration(
                baseURL: configuration.apiBaseURL ?? Self.mockBaseURL,
                appVersion: Self.appVersion(from: bundle),
                locale: Locale.current.identifier
            ),
            // Mock answers registered payloads only and never opens a socket,
            // so that configuration is reproducible offline.
            transport: configuration.environment == .mock
                ? MockClientTransport()
                : nil,
            identifiers: identifiers
        )
        let tokens = KeychainTokenStore()
        let advertisingPolicy = AdvertisingPolicyStore()
        let featureFlags = FeatureFlagClient(
            // The account scope is resolved from the keychain in `start()`; the
            // bundled registry answers until then, so the first screen waits for
            // neither storage nor network.
            cache: UserDefaultsFeatureFlagSnapshotCache(),
            // Mock has no backend to refresh from and must stay deterministic.
            remote: configuration.environment == .mock
                ? nil
                : AppConfigurationRepository(factory: apiClientFactory),
            advertisingSink: advertisingPolicy,
            logger: logger,
            overrides: debugOverrides(for: configuration)
        )

        return AppComposition(
            configuration: configuration,
            router: AppRouter(),
            deepLinkParser: DeepLinkParser(scheme: configuration.deepLinkScheme),
            apiClientFactory: apiClientFactory,
            store: store,
            tokens: tokens,
            dates: SystemDateProvider(),
            identifiers: identifiers,
            logger: logger,
            featureFlags: featureFlags,
            advertising: NoOpAdvertisingProvider(),
            advertisingPolicy: advertisingPolicy,
            adEligibility: AdEligibilityService(flags: featureFlags),
            analytics: NoOpAnalyticsTracker(),
            errorReporter: NoOpErrorReporter(),
            diagnostics: NoOpDiagnosticsReporter(),
            installationScope: InstallationScopeProvider(
                tokens: tokens,
                identifiers: identifiers
            )
        )
    }

    /// Resolves the account scope and asks for a fresh configuration.
    ///
    /// It runs after the first frame on purpose: a snapshot is an improvement
    /// on the bundled defaults, never a precondition for showing a screen.
    func start() async {
        let (scope, isPersisted) = await installationScope.currentGuestScope()
        if !isPersisted {
            logger.log(
                .error,
                "installation.identifier_not_stored",
                category: .persistence
            )
        }
        await featureFlags.refresh(
            context: FeatureFlagContext(
                scope: scope,
                environment: configuration.environment,
                appVersion: Self.appVersion(from: .main),
                build: Self.appBuild(from: .main),
                locale: Locale.current.identifier
            )
        )
    }

    /// Each configuration keeps its own file, so running the Mock build does
    /// not overwrite the progress made against a real backend.
    private static func storeName(for configuration: RuntimeConfiguration) -> String {
        "CountryFlags-\(configuration.environment.rawValue)"
    }

    /// Flag overrides from launch arguments.
    ///
    /// Both guards matter. `#if DEBUG` keeps the code out of a release binary,
    /// and the environment check keeps it out of a Prod build that a developer
    /// runs locally. A release build therefore has no path at all from a launch
    /// argument to a flag value.
    private static func debugOverrides(
        for configuration: RuntimeConfiguration
    ) -> [String: FeatureFlagValue] {
        #if DEBUG
            guard configuration.environment.allowsDebugAffordances else { return [:] }
            return FeatureFlagOverrideParser.overrides(
                from: ProcessInfo.processInfo.arguments
            )
        #else
            return [:]
        #endif
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

    private static func appBuild(from bundle: Bundle) -> String {
        bundle.infoDictionary?["CFBundleVersion"] as? String ?? "0"
    }
}
