import SwiftUI

import CountryFlagsDomain
import CountryFlagsFeatures

@main
struct CountryFlagsApp: App {
    /// Composition root: единственное место, где инфраструктура связывается с
    /// feature-кодом. Контейнер создаётся один раз и передаётся вниз явно, а не
    /// живёт в глобальном singleton.
    @State private var composition: AppComposition

    init() {
        _composition = State(wrappedValue: AppComposition.live())
    }

    var body: some Scene {
        WindowGroup {
            RootView(
                router: composition.router,
                configuration: composition.configuration
            )
            .onOpenURL { url in
                composition.router.open(url, using: composition.deepLinkParser)
            }
        }
    }
}
