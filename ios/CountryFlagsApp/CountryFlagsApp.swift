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
                makeStudyRunner: { composition.makeStudySessionRunner() },
                makeObjectiveRunner: { composition.makeObjectiveSessionRunner() },
                progress: composition.progress,
                makeSettingsStore: { composition.makeSettingsStore() },
                makeAccountStore: { composition.makeAccountStore() },
                makeClearProgressStore: { composition.makeClearProgressStore() },
                makeAccountLifecycleStore: { composition.makeAccountLifecycleStore() },
                makePrivacyStore: { composition.makePrivacyStore() },
                featureFlags: composition.featureFlags,
                sync: composition.sync,
                commerce: composition.commerce,
                // The welcome is the production build's first launch. Every
                // other environment is where the UI suites run, and a sheet
                // over Home would stand in front of each of them; there it is
                // asked for with `-show-welcome` or from Settings → Developer.
                showsWelcomeOnFirstLaunch:
                    !composition.configuration.environment.allowsDebugAffordances
                    || ProcessInfo.processInfo.arguments.contains("-show-welcome")
            )
            .onOpenURL { url in
                // Google's browser round trip comes home through here too;
                // whoever recognises the URL takes it.
                if GoogleSignInAdapter.handle(url) { return }
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
