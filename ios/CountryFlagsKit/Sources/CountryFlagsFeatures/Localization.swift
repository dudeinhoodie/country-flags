import Foundation

/// Доступ к строкам каталога пакета.
///
/// Ключи перечислены здесь, а не разбросаны по View: так пропущенный перевод
/// виден в одном месте, а `Bundle.module` не приходится повторять в каждом
/// вызове.
public enum L10n {
    public static var shellTitle: String {
        localized("shell.title")
    }

    public static var shellSubtitle: String {
        localized("shell.subtitle")
    }

    public static var shellOpenSettings: String {
        localized("shell.open_settings")
    }

    public static var settingsTitle: String {
        localized("settings.title")
    }

    public static var settingsPlaceholder: String {
        localized("settings.placeholder")
    }

    public static var catalogTitle: String {
        localized("catalog.title")
    }

    public static var progressTitle: String {
        localized("progress.title")
    }

    public static var deckTitle: String {
        localized("deck.title")
    }

    public static var routeNotImplemented: String {
        localized("route.not_implemented")
    }

    /// Ресурсный бандл пакета. Тесты используют его, чтобы проверить, что
    /// каталог строк действительно собран, а не подставляет ключи.
    static var bundle: Bundle { .module }

    static func localized(_ key: String) -> String {
        String(localized: String.LocalizationValue(key), bundle: bundle)
    }
}
