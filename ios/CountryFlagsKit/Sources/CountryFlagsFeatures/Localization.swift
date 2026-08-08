import Foundation

import CountryFlagsDomain

/// Access to the string catalog of the package.
///
/// Keys are listed here instead of being spread across views: a missing
/// translation shows up in one place and `Bundle.module` is not repeated at
/// every call site.
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

    public static var advertisementLabel: String {
        localized("ads.slot.label")
    }

    /// The copy a failure is allowed to show.
    ///
    /// It is chosen from the kind, never taken from the response: an error
    /// envelope is written for whoever reads the backend logs and can name an
    /// internal rule, a provider or a record.
    public static func errorMessage(for kind: PresentableError.Kind) -> String {
        localized("error.\(kind.rawValue)")
    }

    /// The line that carries the identifier support needs.
    public static func errorSupportReference(_ requestID: String) -> String {
        String(
            format: localized("error.support_reference"),
            requestID
        )
    }

    /// The resource bundle of the package. Tests use it to verify that the
    /// string catalog is actually compiled instead of falling back to keys.
    static var bundle: Bundle { .module }

    static func localized(_ key: String) -> String {
        String(localized: String.LocalizationValue(key), bundle: bundle)
    }
}
