import Foundation

/// Типизированный маршрут навигации.
///
/// Экраны адресуются значениями, а не строками: deep link разбирается в
/// `AppRoute` до того, как о нём узнает UI, поэтому опечатка в пути не может
/// превратиться в несуществующий экран.
public enum AppRoute: Hashable, Sendable {
    case catalog
    case deck(id: UUID)
    case progress
    case settings
}

/// Разбирает входящий URL в маршрут. Живёт в Domain, потому что не зависит от
/// SwiftUI и полностью проверяется unit-тестами.
public struct DeepLinkParser: Sendable {
    /// Схема, зарегистрированная приложением; задаётся конфигурацией сборки.
    public let scheme: String

    public init(scheme: String) {
        self.scheme = scheme
    }

    public func route(for url: URL) -> AppRoute? {
        guard url.scheme?.lowercased() == scheme.lowercased() else {
            return nil
        }

        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        // Хост несёт имя раздела, путь — идентификатор ресурса:
        // countryflags://deck/<uuid>
        let segments = [components?.host].compactMap { $0 }
            + (components?.path.split(separator: "/").map(String.init) ?? [])

        switch segments.first?.lowercased() {
        case "catalog":
            return segments.count == 1 ? .catalog : nil
        case "deck":
            guard segments.count == 2, let id = UUID(uuidString: segments[1]) else {
                return nil
            }
            return .deck(id: id)
        case "progress":
            return segments.count == 1 ? .progress : nil
        case "settings":
            return segments.count == 1 ? .settings : nil
        default:
            return nil
        }
    }
}
