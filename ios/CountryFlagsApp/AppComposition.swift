import Foundation
import SwiftUI

import CountryFlagsDomain
import CountryFlagsFeatures
import CountryFlagsInfrastructure

/// The dependency set of the app.
///
/// The protocol names what later work packages extend (API, storage, feature
/// flags) while the concrete instance stays substitutable: a test assembles its
/// own container without touching global state.
@MainActor
protocol AppDependencies {
    var configuration: RuntimeConfiguration { get }
    var router: AppRouter { get }
    var deepLinkParser: DeepLinkParser { get }
    var apiTransport: APITransport { get }
    var dates: DateProviding { get }
    var identifiers: IdentifierProviding { get }
}

@MainActor
struct AppComposition: AppDependencies {
    let configuration: RuntimeConfiguration
    let router: AppRouter
    let deepLinkParser: DeepLinkParser
    let apiTransport: APITransport
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

        return AppComposition(
            configuration: configuration,
            router: AppRouter(),
            deepLinkParser: DeepLinkParser(scheme: configuration.deepLinkScheme),
            // Networking arrives with IOS-002. Mock answers registered
            // payloads only; other configurations report honestly that the
            // transport is not assembled.
            apiTransport: configuration.environment == .mock
                ? MockAPITransport()
                : UnconfiguredAPITransport(),
            dates: SystemDateProvider(),
            identifiers: SystemIdentifierProvider()
        )
    }
}
