import Foundation

/// Сборочное окружение приложения.
///
/// Значение приходит из xcconfig через Info.plist, а не из `#if DEBUG`:
/// конфигураций три, а условий компиляции две.
public enum AppEnvironment: String, Hashable, Sendable, CaseIterable {
    case mock
    case dev
    case prod

    /// Отладочные аффордансы допустимы только вне production.
    public var allowsDebugAffordances: Bool {
        self != .prod
    }
}

/// Разрешённая конфигурация текущего запуска.
public struct RuntimeConfiguration: Hashable, Sendable {
    public let environment: AppEnvironment
    public let apiBaseURL: URL?
    public let deepLinkScheme: String

    public init(environment: AppEnvironment, apiBaseURL: URL?, deepLinkScheme: String) {
        self.environment = environment
        self.apiBaseURL = apiBaseURL
        self.deepLinkScheme = deepLinkScheme
    }
}
