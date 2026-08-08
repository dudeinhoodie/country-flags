import Foundation
import Observation

import CountryFlagsDomain

/// The navigation state of the app.
///
/// This object, created by the composition root, is the only owner of the path:
/// there is no global mutable singleton, so a test or a preview gets its own
/// isolated instance.
@MainActor
@Observable
public final class AppRouter {
    public private(set) var path: [AppRoute]

    public init(path: [AppRoute] = []) {
        self.path = path
    }

    public var currentRoute: AppRoute? {
        path.last
    }

    public func push(_ route: AppRoute) {
        path.append(route)
    }

    public func pop() {
        guard !path.isEmpty else {
            return
        }
        path.removeLast()
    }

    public func popToRoot() {
        path.removeAll()
    }

    /// Opens a deep link. An unknown link leaves navigation untouched and
    /// reports that to the caller so it can show a correct error.
    @discardableResult
    public func open(_ url: URL, using parser: DeepLinkParser) -> Bool {
        guard let route = parser.route(for: url) else {
            return false
        }
        path = [route]
        return true
    }

    /// The two-way binding for `NavigationStack`.
    public var navigationPath: [AppRoute] {
        get { path }
        set { path = newValue }
    }
}
