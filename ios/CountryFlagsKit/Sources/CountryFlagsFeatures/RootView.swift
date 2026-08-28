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
    private let progress: ProgressStore
    private let makeSettingsStore: () -> SettingsStore
    private let makeAccountStore: (() -> AccountStore)?
    private let makeClearProgressStore: (() -> ClearProgressStore)?
    private let makePrivacyStore: (() -> PrivacyStore)?
    private let makeAccountLifecycleStore: (() -> AccountLifecycleStore)?
    private let featureFlags: FeatureFlagCenter
    private let sync: SyncCenter

    /// The account the avatar draws. Held here rather than rebuilt in the
    /// toolbar: a store made during a render would be thrown away by the next
    /// one, and the picture would never arrive.
    @State private var accountToolbar: AccountStore?

    /// Whether a sitting has just ended and its answers have not yet come
    /// back as numbers.
    ///
    /// Leaving a session pops to the home screen first and synchronises
    /// after, so the counts there are the backend's previous word for as long
    /// as that takes — which is how a screen showed 86 and then 84 two
    /// seconds later. The window is known exactly here, where the session
    /// closes, rather than guessed at from a pending count that has usually
    /// already drained by the time the home screen is looking.
    @State private var isSettlingAfterSession = false

    /// Whether the launch's own run is still on its way back.
    ///
    /// The shell opens as soon as the counts have been read from the store,
    /// which is what makes a warm launch instant — but those are the numbers
    /// this device was last told, and the run that refreshes them lands after.
    /// So the first thing shown was the previous word, replaced a moment
    /// later: the same flash as leaving a sitting, at the other end of the
    /// app.
    ///
    /// Asked of the sync rather than timed around `start()`: that call
    /// returns at once the second time, and both of the launch's screens make
    /// it, so a flag cleared after it was cleared before anything happened.
    private var isSettlingAtLaunch: Bool { !sync.hasSettledFirstRun }

    @Environment(\.scenePhase) private var scenePhase

    /// How old the catalogue may be before coming back to the app refreshes
    /// it. Ten minutes: long enough that answering the door costs nothing,
    /// short enough that an hour away never shows yesterday's shelf.
    private static let contentStaleAfter: TimeInterval = 600

    public init(
        router: AppRouter,
        configuration: RuntimeConfiguration,
        content: ContentStore,
        assets: any AssetLoading,
        makeStudyRunner: @escaping () -> StudySessionRunner,
        makeObjectiveRunner: @escaping () -> ObjectiveSessionRunner,
        progress: ProgressStore,
        makeSettingsStore: @escaping () -> SettingsStore,
        makeAccountStore: (() -> AccountStore)? = nil,
        makeClearProgressStore: (() -> ClearProgressStore)? = nil,
        makeAccountLifecycleStore: (() -> AccountLifecycleStore)? = nil,
        makePrivacyStore: (() -> PrivacyStore)? = nil,
        featureFlags: FeatureFlagCenter,
        sync: SyncCenter
    ) {
        _router = State(wrappedValue: router)
        self.configuration = configuration
        self.content = content
        self.assets = assets
        self.makeStudyRunner = makeStudyRunner
        self.makeObjectiveRunner = makeObjectiveRunner
        self.progress = progress
        self.makeSettingsStore = makeSettingsStore
        self.makeAccountStore = makeAccountStore
        self.makeClearProgressStore = makeClearProgressStore
        self.makePrivacyStore = makePrivacyStore
        self.makeAccountLifecycleStore = makeAccountLifecycleStore
        self.featureFlags = featureFlags
        self.sync = sync
        // Once, at the root: the segmented control is the system's everywhere,
        // and this is the one place that says how it looks on this scene.
        SegmentedControlAppearance.apply()
    }

    /// Whether a study session sits on the active tab's stack. The root owns
    /// the tab bar's visibility so it flips the moment the router moves —
    /// hidden from the session screen itself, the bar reappeared only after
    /// the pop finished, landing under a thumb already in motion.
    private var isStudyOpen: Bool {
        router.path.contains { route in
            if case .study = route { return true }
            return false
        }
    }

    public var body: some View {
        // The launch is held behind one screen until every first request has
        // landed — the catalogue and the account's numbers both. They arrive
        // at different times, and letting the app in after the first of them
        // meant a deck of 250 cards appearing and then flickering into
        // "nothing to review" a moment later, as the numbers overruled it.
        //
        // A screen rather than an overlay with a gesture: there is nothing
        // behind it worth reaching, so it cannot be dismissed.
        if let waitingFor = launchWait {
            LaunchWaitScreen(
                reason: waitingFor,
                failure: sync.status.lastFailure,
                isRetrying: sync.status.phase == .syncing
                    || content.status.phase != .idle,
                environment: configuration.environment.allowsDebugAffordances
                    ? configuration.environment.rawValue.uppercased()
                    : nil,
                retry: {
                    // Both halves again: whichever of them failed, the
                    // learner asked for the whole launch to be retried.
                    await content.refresh()
                    await sync.synchronize(trigger: .pullToRefresh)
                }
            )
            .preferredColorScheme(.dark)
            // Both first requests start here, so the wait is over exactly
            // when there is something complete to show.
            .task { await content.start() }
            // The counts are read from the store before the network is
            // asked: a guest's numbers are local and complete already, and
            // waiting for a sync run to report them held the launch behind a
            // request that had nothing to do with them.
            .task { await progress.reload() }
            .task { await sync.start() }
        } else {
            shell
        }
    }

    /// What the app is still waiting for, or nil when it can be let in.
    ///
    /// The question is what the store holds, not whether this process has
    /// been to the network. Waiting on the sync meant a device with the whole
    /// catalogue already on it sat behind a spinner on every launch, which
    /// threw away the offline-first behaviour the store exists for (#266).
    ///
    /// `.loading` is the store's own word for "nothing to draw"; `.empty` and
    /// `.failed` are answers, and the app shows them as screens of their own.
    ///
    /// The order is the order they arrive in, and it is also the order the
    /// screen should speak in: with no catalogue there is nothing to put
    /// numbers on, so that wait is named first and is the only one a guest
    /// ever sees (#270).
    ///
    /// The stores answer this, not the sync status. A run reports success
    /// before the store has re-read what it delivered, so waiting on the run
    /// let the app open one frame early — long enough for the learned-countries
    /// block to appear a moment after the screen it belongs to. The store
    /// settles on `backend` once it has read the answer, empty or not.
    private var launchWait: LaunchWaitScreen.Reason? {
        LaunchWaitScreen.Reason.waiting(
            hasCatalog: content.hasSomethingToShow,
            isGuest: progress.isGuest,
            origin: progress.origin
        )
    }

    /// The two ways out of any tab: the account on the left, the settings on
    /// the right.
    ///
    /// On every tab rather than on Home alone. They used to hang off the Home
    /// screen, so reaching either from the catalog or the progress meant going
    /// back to Home first — a trip through an unrelated screen to change a
    /// setting (#273). Their place in the bar does not move between tabs,
    /// which is what makes them findable without looking.
    @ToolbarContentBuilder
    private var accountAndSettings: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                router.push(.settings)
            } label: {
                Image(systemName: "gearshape")
            }
            .accessibilityLabel(L10n.shellOpenSettings)
            .accessibilityIdentifier(AccessibilityIdentifier.openSettingsButton)
        }
        if makeAccountLifecycleStore != nil {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    router.push(.account)
                } label: {
                    AccountAvatarButtonLabel(
                        profile: accountToolbar?.profile,
                        avatar: accountToolbar?.avatar
                    )
                }
                .accessibilityLabel(L10n.accountOpen)
                .accessibilityIdentifier(AccessibilityIdentifier.accountOpen)
            }
        }
    }

    private var shell: some View {
        // A tab bar rather than buttons on Home: the catalog and the progress
        // are places, and iOS puts places on the bottom bar. The bar's glass
        // is the system's own.
        TabView(selection: $router.tab) {
            NavigationStack(path: $router.homeNavigationPath) {
                HomeView(
                    store: content,
                    sync: sync,
                    assets: assets,
                    progress: progress,
                    isSettling: isSettlingAfterSession || isSettlingAtLaunch,
                    makeSettings: makeSettingsStore,
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
                    // The catalog is a tab, not a push: sending the learner
                    // there as a stacked screen would leave a back arrow over
                    // a tab bar that already shows where they are.
                    onOpenCatalog: { router.tab = .catalog },
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
                    // Between the avatar and the gear, which is where a
                    // learner already looks for the state of their account.
                    // Home alone: it is status rather than a way anywhere, and
                    // this is the tab that gives up its title for it.
                    ToolbarItem(placement: .principal) {
                        SyncStatusChip(status: sync.status)
                    }
                    accountAndSettings
                }
                .navigationDestination(for: AppRoute.self) { route in
                    destination(for: route)
                }
            }
            .toolbar(isStudyOpen ? .hidden : .automatic, for: .tabBar)
            .tabItem { Label(L10n.homeTitle, systemImage: "house") }
            .tag(AppTab.home)

            NavigationStack(path: $router.catalogNavigationPath) {
                CatalogView(store: content, assets: assets, progress: progress) { router.push(.deck(id: $0)) }
                    .toolbar { accountAndSettings }
                    .navigationDestination(for: AppRoute.self) { route in
                        destination(for: route)
                    }
            }
            .toolbar(isStudyOpen ? .hidden : .automatic, for: .tabBar)
            .tabItem { Label(L10n.catalogTitle, systemImage: "square.grid.2x2") }
            .tag(AppTab.catalog)

            NavigationStack(path: $router.progressNavigationPath) {
                ProgressScreen(
                    store: progress,
                    onOpenDeck: { router.push(.deckProgress(deckID: $0)) }
                )
                .toolbar { accountAndSettings }
                .navigationDestination(for: AppRoute.self) { route in
                    destination(for: route)
                }
            }
            .toolbar(isStudyOpen ? .hidden : .automatic, for: .tabBar)
            .tabItem { Label(L10n.progressTitle, systemImage: "chart.bar") }
            .tag(AppTab.progress)

            // The achievements tab was tried and taken out the same day: a
            // fourth tab for a list the sync fills on its own schedule read
            // as an empty room. The screen and its stack stay in the package
            // for whenever the trophies earn their place back.
        }
        // The scene is dark, so the app is: system controls, sheets and the
        // bars all take their colours from here rather than each screen
        // fighting the light appearance on its own.
        .preferredColorScheme(.dark)
        // Recovery and the first sync happen once, after the first frame:
        // everything on screen already answers from the store.
        .task {
            if accountToolbar == nil { accountToolbar = makeAccountStore?() }
            await accountToolbar?.start()
        }
        // A warm launch opens straight into the shell, so the first read of
        // the counts happens here rather than on the waiting screen. Both
        // calls are idempotent; whichever screen the launch lands on, the
        // store is read once and the run starts once.
        .task { await progress.reload() }
        .task { await sync.start() }
        .onChange(of: isStudyOpen) { wasOpen, isOpen in
            guard wasOpen, !isOpen else { return }
            Task {
                // Opening a sitting and leaving it without answering changes
                // nothing the backend has not got, so nothing is asked for
                // and no spinner is spent on it. The counts are still re-read
                // from the store: a guest's work never leaves the device, so
                // for them this local pass is the whole of it.
                guard await sync.hasPendingWork() else {
                    await progress.reload()
                    return
                }
                isSettlingAfterSession = true
                await sync.synchronize(trigger: .sessionCompleted)
                isSettlingAfterSession = false
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // The one place the app reacts to coming back. Screens used to
            // watch this too, so a return ran the same reads twice and the
            // two overlapping passes raced each other.
            guard phase == .active else { return }
            Task {
                await content.refreshIfStale(olderThan: Self.contentStaleAfter)
                await sync.synchronize(trigger: .foreground)
            }
        }
    }

    @ViewBuilder
    private func destination(for route: AppRoute) -> some View {
        switch route {
        case .catalog:
            CatalogView(store: content, assets: assets, progress: progress) { router.push(.deck(id: $0)) }
        case .deck(let id):
            DeckDetailsView(
                deckID: id,
                store: content,
                assets: assets,
                makeSettings: makeSettingsStore,
                progress: progress,
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
                    onFinish: { router.pop() }
                )
            case .multipleChoice:
                ObjectiveSessionView(
                    deckID: deckID,
                    size: size,
                    runner: makeObjectiveRunner(),
                    store: content,
                    assets: assets,
                    onFinish: { router.pop() }
                )
            }
        case .progress:
            ProgressScreen(
                store: progress,
                onOpenDeck: { router.push(.deckProgress(deckID: $0)) }
            )
        case .deckProgress(let deckID):
            DeckProgressDetailsView(
                deckID: deckID,
                store: content,
                assets: assets,
                progress: progress,
                makeSettings: makeSettingsStore,
                onStartStudy: { deckID, size in
                    router.push(
                        .study(deckID: deckID, size: size, mode: .selfRated, composition: .standard)
                    )
                }
            )
        case .settings:
            // No account block here any more: it lives behind the avatar,
            // with the screen it is about. Two entrances to one place is one
            // entrance too many.
            SettingsScreen(
                store: makeSettingsStore(),
                makePrivacy: makePrivacyStore,
                environmentBadge: configuration.environment.allowsDebugAffordances
                    ? configuration.environment.rawValue.uppercased()
                    : nil
            )
        case .account:
            if let makeAccountLifecycleStore {
                AccountScreen(
                    store: makeAccountLifecycleStore(),
                    makeAccount: makeAccountStore,
                    makeClearProgress: makeClearProgressStore,
                    privacyPolicyURL: configuration.privacyPolicyURL,
                    termsURL: configuration.termsURL
                )
            }
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
    /// The launch wait — for the catalogue or for an account's numbers — and
    /// the way out of it when the backend cannot be reached.
    public static let launchWait = "root.launchWait"
    public static let launchWaitRetry = "root.launchWait.retry"

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
    /// The day's queue, which is a different button from the way back into an
    /// unfinished sitting — they can now stand on the screen together.
    public static let homeReview = "home.review"
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
    public static let settingsRemindersAllow = "settings.reminders.allow"
    public static let settingsRemindersOpenSystemSettings = "settings.reminders.openSystemSettings"
    public static let settingsConflict = "settings.conflict"
    public static let privacyProductAnalytics = "settings.privacy.productAnalytics"
    public static let privacyDiagnostics = "settings.privacy.diagnostics"
    public static let privacyConflict = "settings.privacy.conflict"
    public static let settingsClearProgress = "settings.clearProgress"
    public static let settingsClearProgressConfirm = "settings.clearProgress.confirm"
    public static let settingsClearProgressStatus = "settings.clearProgress.status"
    public static let accountOpen = "account.open"
    public static let settingsDeletionPending = "settings.account.deletionPending"
    public static let accountDeletionPending = "account.deletionPending"
    public static let accountLinkApple = "account.link.apple"
    public static let accountLinkGoogle = "account.link.google"
    public static let accountLinkFixture = "account.link.fixture"
    public static let accountSwitchAccounts = "account.switchAccounts"
    public static let accountExportRequest = "account.export.request"
    public static let accountExportPreparing = "account.export.preparing"
    public static let accountExportShare = "account.export.share"
    public static let accountExportFailed = "account.export.failed"
    public static let accountPrivacyPolicy = "account.privacyPolicy"
    public static let accountTerms = "account.terms"
    public static let accountDelete = "account.delete"
    public static let accountDeleteConfirm = "account.delete.confirm"
    public static let accountDeleteStatus = "account.delete.status"
    public static let accountProveApple = "account.prove.apple"
    public static let accountProveGoogle = "account.prove.google"
    public static let accountProveFixture = "account.prove.fixture"

    /// Rows are addressed by what they are about — a provider, a device — so a
    /// test does not depend on the order the backend listed them in.
    public static func accountIdentityRow(_ provider: String) -> String {
        "account.identity.\(provider)"
    }

    public static func accountUnlink(_ provider: String) -> String {
        "account.unlink.\(provider)"
    }

    public static func accountRevokeDevice(_ deviceID: UUID) -> String {
        "account.revokeDevice.\(deviceID.uuidString)"
    }

    public static let clearProgressProveApple = "clearProgress.prove.apple"
    public static let clearProgressProveGoogle = "clearProgress.prove.google"
    public static let clearProgressProveFixture = "clearProgress.prove.fixture"

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
    public static let deckResume = "deck.resume"
    public static let homeLoading = "home.loading"

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

    /// Present only when a placement really draws something, so a UI test can
    /// assert that a build without a provider shows no ad surface at all.
    public static func adSlot(_ placement: AdPlacement) -> String {
        "ads.slot.\(placement.rawValue)"
    }
}
