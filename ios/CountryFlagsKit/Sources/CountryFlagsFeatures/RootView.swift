import SwiftUI

import CountryFlagsDomain

/// The root shell of the app.
///
/// Home is the root screen and the catalog and a deck are destinations on the
/// same stack, so a deep link to a deck lands on a screen the user can back out
/// of.
public struct RootView: View {
    @State private var router: AppRouter
    private let configuration: RuntimeConfiguration
    private let content: ContentStore
    private let assets: any AssetLoading
    private let makeStudyRunner: () -> StudySessionRunner
    private let makeObjectiveRunner: () -> ObjectiveSessionRunner
    private let makeProgressStore: () -> ProgressStore
    private let makeSettingsStore: () -> SettingsStore
    private let makeAccountStore: (() -> AccountStore)?
    private let featureFlags: FeatureFlagCenter
    private let sync: SyncCenter

    @Environment(\.scenePhase) private var scenePhase

    public init(
        router: AppRouter,
        configuration: RuntimeConfiguration,
        content: ContentStore,
        assets: any AssetLoading,
        makeStudyRunner: @escaping () -> StudySessionRunner,
        makeObjectiveRunner: @escaping () -> ObjectiveSessionRunner,
        makeProgressStore: @escaping () -> ProgressStore,
        makeSettingsStore: @escaping () -> SettingsStore,
        makeAccountStore: (() -> AccountStore)? = nil,
        featureFlags: FeatureFlagCenter,
        sync: SyncCenter
    ) {
        _router = State(wrappedValue: router)
        self.configuration = configuration
        self.content = content
        self.assets = assets
        self.makeStudyRunner = makeStudyRunner
        self.makeObjectiveRunner = makeObjectiveRunner
        self.makeProgressStore = makeProgressStore
        self.makeSettingsStore = makeSettingsStore
        self.makeAccountStore = makeAccountStore
        self.featureFlags = featureFlags
        self.sync = sync
    }

    public var body: some View {
        // A tab bar rather than buttons on Home: the catalog and the progress
        // are places, and iOS puts places on the bottom bar. The bar's glass
        // is the system's own.
        TabView(selection: $router.tab) {
            NavigationStack(path: $router.homeNavigationPath) {
                HomeView(
                    store: content,
                    sync: sync,
                    makeProgress: makeProgressStore,
                    onOpenDeck: { router.push(.deck(id: $0)) },
                    // Straight back into the run: the hero already names the
                    // deck and the position, and a country list in between is
                    // a detour. The deck screen keeps its own offer for the
                    // learner who walks in through the catalog.
                    onContinueSession: { continuable in
                        router.push(
                            .study(
                                deckID: continuable.deckID,
                                size: continuable.size,
                                mode: continuable.mode,
                                composition: .standard
                            )
                        )
                    },
                    onStartStudy: { deckID, size, mode, composition in
                        router.push(
                            .study(
                                deckID: deckID,
                                size: size,
                                mode: mode,
                                composition: composition
                            )
                        )
                    }
                )
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            router.push(.settings)
                        } label: {
                            Image(systemName: "gearshape")
                        }
                        .accessibilityLabel(L10n.shellOpenSettings)
                        .accessibilityIdentifier(AccessibilityIdentifier.openSettingsButton)
                    }
                    if configuration.environment.allowsDebugAffordances {
                        ToolbarItem(placement: .topBarLeading) {
                            Text(verbatim: configuration.environment.rawValue.uppercased())
                                .font(DesignTokens.Typography.caption)
                                .accessibilityIdentifier(AccessibilityIdentifier.environmentBadge)
                        }
                    }
                }
                .navigationDestination(for: AppRoute.self) { route in
                    destination(for: route)
                }
            }
            .tabItem { Label(L10n.homeTitle, systemImage: "house") }
            .tag(AppTab.home)

            NavigationStack(path: $router.catalogNavigationPath) {
                CatalogView(store: content, assets: assets) { router.push(.deck(id: $0)) }
                    .navigationDestination(for: AppRoute.self) { route in
                        destination(for: route)
                    }
            }
            .tabItem { Label(L10n.catalogTitle, systemImage: "square.grid.2x2") }
            .tag(AppTab.catalog)

            NavigationStack(path: $router.progressNavigationPath) {
                ProgressScreen(
                    store: makeProgressStore(),
                    onOpenDeck: { router.push(.deckProgress(deckID: $0)) }
                )
                .navigationDestination(for: AppRoute.self) { route in
                    destination(for: route)
                }
            }
            .tabItem { Label(L10n.progressTitle, systemImage: "chart.bar") }
            .tag(AppTab.progress)

            NavigationStack(path: $router.achievementsNavigationPath) {
                AchievementsScreen(store: makeProgressStore())
                    .navigationDestination(for: AppRoute.self) { route in
                        destination(for: route)
                    }
            }
            .tabItem { Label(L10n.achievementsTitle, systemImage: "rosette") }
            .tag(AppTab.achievements)
        }
        // The scene is dark, so the app is: system controls, sheets and the
        // bars all take their colours from here rather than each screen
        // fighting the light appearance on its own.
        .preferredColorScheme(.dark)
        // Recovery and the first sync happen once, after the first frame:
        // everything on screen already answers from the store.
        .task { await sync.start() }
        .onChange(of: scenePhase) { _, phase in
            // Returning to the foreground is a trigger like any other, and the
            // coordinator coalesces it with whatever is already running.
            guard phase == .active else { return }
            Task { await sync.synchronize(trigger: .foreground) }
        }
    }

    @ViewBuilder
    private func destination(for route: AppRoute) -> some View {
        switch route {
        case .catalog:
            CatalogView(store: content, assets: assets) { router.push(.deck(id: $0)) }
        case .deck(let id):
            DeckDetailsView(
                deckID: id,
                store: content,
                assets: assets,
                makeSettings: makeSettingsStore,
                makeProgress: makeProgressStore,
                isObjectiveModeEnabled: featureFlags.isEnabled(.studyMultipleChoiceEnabled)
            ) { deckID, size, mode in
                router.push(
                    .study(deckID: deckID, size: size, mode: mode, composition: .standard)
                )
            }
        case .study(let deckID, let size, let mode, let composition):
            switch mode {
            case .selfRated:
                StudySessionView(
                    deckID: deckID,
                    size: size,
                    composition: composition,
                    runner: makeStudyRunner(),
                    store: content,
                    assets: assets,
                    onFinish: {
                        router.pop()
                        Task { await sync.synchronize(trigger: .sessionCompleted) }
                    }
                )
            case .multipleChoice:
                ObjectiveSessionView(
                    deckID: deckID,
                    size: size,
                    runner: makeObjectiveRunner(),
                    store: content,
                    assets: assets,
                    onFinish: {
                        router.pop()
                        Task { await sync.synchronize(trigger: .sessionCompleted) }
                    }
                )
            }
        case .progress:
            ProgressScreen(
                store: makeProgressStore(),
                onOpenDeck: { router.push(.deckProgress(deckID: $0)) }
            )
        case .deckProgress(let deckID):
            DeckProgressDetailsView(
                deckID: deckID,
                store: content,
                assets: assets,
                makeProgress: makeProgressStore,
                makeSettings: makeSettingsStore,
                onStartStudy: { deckID, size in
                    router.push(
                        .study(deckID: deckID, size: size, mode: .selfRated, composition: .standard)
                    )
                }
            )
        case .settings:
            SettingsScreen(store: makeSettingsStore(), makeAccount: makeAccountStore)
        }
    }
}

/// Identifiers for UI tests. They are never localized, so a test does not
/// depend on the language of the simulator.
///
/// Every identifier sits on a leaf view. An accessibility identifier applied to
/// a SwiftUI container propagates to its descendants and overrides the ones
/// they set themselves, which makes the children indistinguishable in a query.
public enum AccessibilityIdentifier {
    public static let shellTitle = "root.shell.title"
    public static let openSettingsButton = "root.shell.openSettings"
    public static let environmentBadge = "root.shell.environmentBadge"

    public static let homeGreeting = "home.greeting"
    public static let homeOpenCatalog = "home.openCatalog"
    public static let contentLoadingLabel = "content.loading"
    public static let contentStatusBanner = "content.statusBanner"
    public static let contentPlaceholderTitle = "content.placeholder.title"
    public static let contentRetryButton = "content.placeholder.retry"
    public static let catalogLocaleFallback = "catalog.localeFallback"
    public static let catalogNoMatches = "catalog.noMatches"
    public static let deckCardCount = "deck.cardCount"
    public static let deckNoMatches = "deck.noMatches"
    public static let flagImage = "content.flag.image"
    public static let flagPlaceholder = "content.flag.placeholder"

    /// Deck rows are addressed by the deck's own code rather than by index, so
    /// a test does not break when the catalog gains a deck.
    public static func catalogDeckRow(_ code: String) -> String {
        "catalog.deck.\(code)"
    }

    public static func homeDeckRow(_ code: String) -> String {
        "home.deck.\(code)"
    }

    public static func homeDueRow(_ code: String) -> String {
        "home.due.\(code)"
    }

    public static let homeDueEmpty = "home.due.empty"
    public static let achievementsEmpty = "achievements.empty"
    public static let studyDeckName = "study.deckName"

    public static func deckCountryRow(_ cardID: UUID) -> String {
        "deck.country.\(cardID.uuidString)"
    }

    public static let homeOpenProgress = "home.openProgress"
    public static let progressEmpty = "progress.empty"

    public static func progressDeckRow(_ code: String) -> String {
        "progress.deck.\(code)"
    }

    public static func progressDeckCounts(_ code: String) -> String {
        "progress.deck.\(code).counts"
    }

    public static let accountSignInApple = "settings.account.signInApple"
    public static let accountFakeSignIn = "settings.account.fakeSignIn"
    public static let accountSignInGoogle = "settings.account.signInGoogle"
    public static let accountSignedIn = "settings.account.signedIn"
    public static let accountSigningIn = "settings.account.signingIn"
    public static let accountSignOut = "settings.account.signOut"
    public static let accountExpired = "settings.account.expired"
    public static let accountFailure = "settings.account.failure"
    public static let accountMigrationImported = "settings.account.migrationImported"

    public static let settingsSound = "settings.sound"
    public static let settingsHaptics = "settings.haptics"
    public static let settingsReminders = "settings.reminders"
    public static let settingsConflict = "settings.conflict"

    public static func settingsSessionSize(_ size: Int) -> String {
        "settings.sessionSize.\(size)"
    }

    public static let studyStart = "study.start"
    public static let studyProgress = "study.progress"
    /// The card being answered, and the ones behind it in the stack.
    public static let studyCard = "study.card"
    public static let studyCardBehind = "study.card.behind"
    public static let studyDetails = "study.details"
    /// The small map on the country sheet, which opens the full one.
    public static let studyMap = "study.details.map"
    public static let studyClose = "study.close"
    public static let studyReveal = "study.reveal"
    /// Facts are addressed by the type they carry rather than by position: a
    /// release decides how many a country has.
    public static func studyFact(_ type: String) -> String {
        "study.fact.\(type.uppercased())"
    }
    public static let studyAnswer = "study.answer"
    public static let studyNotSaved = "study.notSaved"
    public static let studyUnavailable = "study.unavailable"
    public static let studyResultTitle = "study.result.title"
    public static let studyResultAnswered = "study.result.answered"
    public static let studyResultDone = "study.result.done"
    /// The one action the first screen recommends.
    public static let homeContinue = "home.continue"

    public static func studyRating(_ rating: StudyRating) -> String {
        "study.rating.\(rating.rawValue)"
    }

    public static func studyResultRating(_ rating: StudyRating) -> String {
        "study.result.rating.\(rating.rawValue)"
    }

    public static let syncStatus = "sync.status"
    public static let studyNext = "study.next"
    public static let studyModeObjective = "study.mode.objective"
    public static let studyModeSelfRated = "study.mode.selfRated"

    /// Options are addressed by their fixed position, which is what a test can
    /// tap without knowing which country the seed put there.
    public static func studyOption(_ position: Int) -> String {
        "study.option.\(position)"
    }

    public static func studySizeOption(_ size: StudySessionSize) -> String {
        "study.size.\(size.rawValue)"
    }

    /// Present only when a placement really draws something, so a UI test can
    /// assert that a build without a provider shows no ad surface at all.
    public static func adSlot(_ placement: AdPlacement) -> String {
        "ads.slot.\(placement.rawValue)"
    }
}
