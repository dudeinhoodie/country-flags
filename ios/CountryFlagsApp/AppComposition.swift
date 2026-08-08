import Foundation
import SwiftUI

import CountryFlagsDomain
import CountryFlagsFeatures
import CountryFlagsInfrastructure

/// Набор зависимостей приложения.
///
/// Протокол задаёт то, что последующие задачи будут расширять (API, storage,
/// feature flags), а конкретный экземпляр остаётся заменяемым: тест собирает
/// свой контейнер, не трогая глобальное состояние.
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
            // Сборка без корректного xcconfig неработоспособна: падение здесь
            // дешевле, чем приложение, молча ушедшее в неизвестное окружение.
            fatalError("Invalid build configuration: \(error)")
        }

        return AppComposition(
            configuration: configuration,
            router: AppRouter(),
            deepLinkParser: DeepLinkParser(scheme: configuration.deepLinkScheme),
            // Сеть появится в IOS-002; Mock отвечает только заданными payload,
            // остальные конфигурации честно сообщают, что транспорт не собран.
            apiTransport: configuration.environment == .mock
                ? MockAPITransport()
                : UnconfiguredAPITransport(),
            dates: SystemDateProvider(),
            identifiers: SystemIdentifierProvider()
        )
    }
}
