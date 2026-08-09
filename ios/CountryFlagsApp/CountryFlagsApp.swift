import SwiftUI

import CountryFlagsDomain
import CountryFlagsFeatures

@main
struct CountryFlagsApp: App {
    /// Composition root: the only place where infrastructure is wired to
    /// feature code. The container is built once and passed down explicitly
    /// instead of living in a global singleton.
    @State private var composition: AppComposition

    init() {
        _composition = State(wrappedValue: AppComposition.live())
    }

    var body: some Scene {
        WindowGroup {
            RootView(
                router: composition.router,
                configuration: composition.configuration,
                content: composition.content,
                assets: composition.assets,
                makeStudyRunner: { composition.makeStudySessionRunner() }
            )
            .onOpenURL { url in
                composition.router.open(url, using: composition.deepLinkParser)
            }
            // After the first frame: every flag already answers from the
            // bundled defaults or the cached snapshot, so nothing on screen
            // waits for this.
            .task {
                await composition.start()
            }
        }
    }
}
