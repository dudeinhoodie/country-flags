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
        self.featureFlags = featureFlags
        self.sync = sync
    }

    public var body: some View {
        NavigationStack(path: $router.navigationPath) {
            HomeView(
                store: content,
                sync: sync,
                onOpenCatalog: { router.push(.catalog) },
                onOpenProgress: { router.push(.progress) },
                onOpenDeck: { router.push(.deck(id: $0)) }
            )
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L10n.shellOpenSettings) {
                        router.push(.settings)
                    }
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
            CatalogView(store: content) { router.push(.deck(id: $0)) }
        case .deck(let id):
            DeckDetailsView(
                deckID: id,
                store: content,
                assets: assets,
                isObjectiveModeEnabled: featureFlags.isEnabled(.studyMultipleChoiceEnabled)
            ) { deckID, size, mode in
                router.push(.study(deckID: deckID, size: size, mode: mode))
            }
        case .study(let deckID, let size, let mode):
            switch mode {
            case .selfRated:
                StudySessionView(
                    deckID: deckID,
                    size: size,
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
            ProgressScreen(store: makeProgressStore())
        case .settings:
            SettingsScreen(store: makeSettingsStore())
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

    public static let settingsSound = "settings.sound"
    public static let settingsHaptics = "settings.haptics"
    public static let settingsReminders = "settings.reminders"
    public static let settingsConflict = "settings.conflict"

    public static func settingsSessionSize(_ size: Int) -> String {
        "settings.sessionSize.\(size)"
    }

    public static let studyStart = "study.start"
    public static let studyProgress = "study.progress"
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
