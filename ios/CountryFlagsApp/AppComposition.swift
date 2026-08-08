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
    var dates: DateProviding { get }
    var identifiers: IdentifierProviding { get }
}

@MainActor
struct AppComposition: AppDependencies {
    let configuration: RuntimeConfiguration
    let router: AppRouter
    let deepLinkParser: DeepLinkParser
    let apiClientFactory: APIClientFactory
    let dates: DateProviding
    let identifiers: IdentifierProviding

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
        return AppComposition(
            configuration: configuration,
            router: AppRouter(),
            deepLinkParser: DeepLinkParser(scheme: configuration.deepLinkScheme),
            apiClientFactory: APIClientFactory(
                configuration: APIClientConfiguration(
                    baseURL: configuration.apiBaseURL ?? Self.mockBaseURL,
                    appVersion: Self.appVersion(from: bundle),
                    locale: Locale.current.identifier
                ),
                // Mock answers registered payloads only and never opens a
                // socket, so that configuration is reproducible offline.
                transport: configuration.environment == .mock
                    ? MockClientTransport()
                    : nil,
                identifiers: identifiers
            ),
            dates: SystemDateProvider(),
            identifiers: identifiers
        )
    }

    /// The Mock configuration has no backend. The URL is never dialed; it only
    /// satisfies the client, which requires a server URL.
    private static let mockBaseURL = URL(string: "https://mock.invalid")!

    private static func appVersion(from bundle: Bundle) -> String {
        bundle.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }
}
