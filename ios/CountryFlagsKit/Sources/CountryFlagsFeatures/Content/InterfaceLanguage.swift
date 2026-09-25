import Foundation

/// The language the interface is shown in, which is the language content is
/// asked for.
///
/// The device's own list is the wrong thing to match content against: it
/// names languages the app has no words in. A phone set to German resolved
/// its interface to English, the string catalog's development language,
/// while the content, matched against the same list, found nothing and fell
/// back to the release's default, which is Russian — "All countries" beside
/// "Все страны" (#448). Asking the string catalog which localization it
/// resolved makes the two fall back together, the way `DocumentURL` already
/// does for the published documents.
public enum InterfaceLanguage {
    /// The localizations the interface resolved on this device, most wanted
    /// first. What every content request is matched against.
    public static var preferredLanguages: [String] {
        L10n.bundle.preferredLocalizations
    }

    /// What `preferredLanguages` answers on a device whose languages are
    /// `devicePreferences`, so a test can state them instead of changing the
    /// simulator. The same resolution the bundle runs for itself.
    static func preferredLanguages(forDevice devicePreferences: [String]) -> [String] {
        Bundle.preferredLocalizations(
            from: L10n.bundle.localizations,
            forPreferences: devicePreferences
        )
    }
}
