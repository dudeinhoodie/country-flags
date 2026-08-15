import Foundation
import Observation

import CountryFlagsDomain

/// The tabs the app stands on.
public enum AppTab: String, Hashable, Sendable {
    case home
    case catalog
    case progress
    case achievements
}

/// The navigation state of the app.
///
/// This object, created by the composition root, is the only owner of the
/// tab and of each tab's stack: there is no global mutable singleton, so a
/// test or a preview gets its own isolated instance. `push` and `pop` act on
/// the stack of the tab the user is looking at — a session opened from the
/// catalog closes back to the catalog.
@MainActor
@Observable
public final class AppRouter {
    public var tab: AppTab
    public private(set) var homePath: [AppRoute]
    public private(set) var catalogPath: [AppRoute] = []
    public private(set) var progressPath: [AppRoute] = []
    public private(set) var achievementsPath: [AppRoute] = []

    public init(path: [AppRoute] = [], tab: AppTab = .home) {
        homePath = path
        self.tab = tab
    }

    /// The active tab's stack.
    public var path: [AppRoute] {
        switch tab {
        case .home: homePath
        case .catalog: catalogPath
        case .progress: progressPath
        case .achievements: achievementsPath
        }
    }

    public var currentRoute: AppRoute? {
        path.last
    }

    public func push(_ route: AppRoute) {
        setPath(path + [route])
    }

    public func pop() {
        guard !path.isEmpty else {
            return
        }
        setPath(Array(path.dropLast()))
    }

    public func popToRoot() {
        setPath([])
    }

    /// Opens a deep link. An unknown link leaves navigation untouched and
    /// reports that to the caller so it can show a correct error.
    ///
    /// A link to a tab's own screen switches the tab; anything deeper lands
    /// on the home stack, which is where a person opening the app from
    /// outside expects to be standing.
    @discardableResult
    public func open(_ url: URL, using parser: DeepLinkParser) -> Bool {
        guard let route = parser.route(for: url) else {
            return false
        }
        switch route {
        case .catalog:
            tab = .catalog
            catalogPath = []
        case .progress:
            tab = .progress
            progressPath = []
        default:
            tab = .home
            homePath = [route]
        }
        return true
    }

    // MARK: - The two-way bindings for each tab's `NavigationStack`

    public var homeNavigationPath: [AppRoute] {
        get { homePath }
        set { homePath = newValue }
    }

    public var catalogNavigationPath: [AppRoute] {
        get { catalogPath }
        set { catalogPath = newValue }
    }

    public var progressNavigationPath: [AppRoute] {
        get { progressPath }
        set { progressPath = newValue }
    }

    public var achievementsNavigationPath: [AppRoute] {
        get { achievementsPath }
        set { achievementsPath = newValue }
    }

    private func setPath(_ newPath: [AppRoute]) {
        switch tab {
        case .home: homePath = newPath
        case .catalog: catalogPath = newPath
        case .progress: progressPath = newPath
        case .achievements: achievementsPath = newPath
        }
    }
}
