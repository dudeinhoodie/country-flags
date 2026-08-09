import SwiftUI

import CountryFlagsDomain

/// The root shell of the app.
///
/// Home is the root screen and the catalog and a deck are destinations on the
/// same stack, so a deep link to a deck lands on a screen the user can back out
/// of. Progress and settings are still placeholders: they arrive with their own
/// work packages.
public struct RootView: View {
    @State private var router: AppRouter
    private let configuration: RuntimeConfiguration
    private let content: ContentStore
    private let assets: any AssetLoading

    public init(
        router: AppRouter,
        configuration: RuntimeConfiguration,
        content: ContentStore,
        assets: any AssetLoading
    ) {
        _router = State(wrappedValue: router)
        self.configuration = configuration
        self.content = content
        self.assets = assets
    }

    public var body: some View {
        NavigationStack(path: $router.navigationPath) {
            HomeView(
                store: content,
                onOpenCatalog: { router.push(.catalog) },
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
    }

    @ViewBuilder
    private func destination(for route: AppRoute) -> some View {
        switch route {
        case .catalog:
            CatalogView(store: content) { router.push(.deck(id: $0)) }
        case .deck(let id):
            DeckDetailsView(deckID: id, store: content, assets: assets)
        case .progress, .settings:
            RouteView(route: route)
        }
    }
}

/// A placeholder destination for the screens whose work packages have not
/// landed, while the route is already typed and covered by a UI test.
struct RouteView: View {
    let route: AppRoute

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.medium) {
            Text(title)
                .font(DesignTokens.Typography.sectionTitle)
                .accessibilityIdentifier(AccessibilityIdentifier.routeTitle)
            Text(L10n.routeNotImplemented)
                .font(DesignTokens.Typography.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding(DesignTokens.Spacing.large)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var title: String {
        switch route {
        case .catalog: L10n.catalogTitle
        case .deck: L10n.deckTitle
        case .progress: L10n.progressTitle
        case .settings: L10n.settingsTitle
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
    public static let routeTitle = "root.route.title"

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

    /// Present only when a placement really draws something, so a UI test can
    /// assert that a build without a provider shows no ad surface at all.
    public static func adSlot(_ placement: AdPlacement) -> String {
        "ads.slot.\(placement.rawValue)"
    }
}
