import Foundation
import Observation

import CountryFlagsDomain

/// Состояние навигации приложения.
///
/// Единственный владелец пути — этот объект, создаваемый composition root:
/// глобального mutable singleton нет, поэтому тест или preview получает свой
/// изолированный экземпляр.
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

    /// Открывает deep link. Неизвестная ссылка не меняет навигацию и сообщает
    /// об этом вызывающему коду, чтобы тот мог показать корректную ошибку.
    @discardableResult
    public func open(_ url: URL, using parser: DeepLinkParser) -> Bool {
        guard let route = parser.route(for: url) else {
            return false
        }
        path = [route]
        return true
    }

    /// Двусторонняя привязка для `NavigationStack`.
    public var navigationPath: [AppRoute] {
        get { path }
        set { path = newValue }
    }
}
