import Foundation

/// Which locale the client asks the backend for, and which name it shows when
/// the answer does not contain the one it wanted.
///
/// The backend localizes content per request rather than shipping every
/// language, so the choice is made once and travels with every content call. It
/// is a value type with no `Locale` lookups of its own so a test can state the
/// device languages instead of changing the simulator.
public struct ContentLocaleResolver: Hashable, Sendable {
    /// The languages the device prefers, most wanted first, in BCP 47.
    public let preferredLanguages: [String]

    public init(preferredLanguages: [String]) {
        self.preferredLanguages = preferredLanguages
    }

    /// Picks the locale to request for a release.
    ///
    /// The fallback is documented rather than clever, because a user who sees
    /// the wrong language needs an explanation that holds: an exact match wins,
    /// then a locale sharing the language subtag ("ru-RU" is served by "ru"),
    /// then the default the manifest names. The manifest's default is trusted
    /// last because it is the one locale the backend guarantees exists.
    public func resolve(supported: [String], default defaultLocale: String) -> ContentLocaleResolution {
        for preferred in preferredLanguages {
            if let exact = supported.first(where: { $0.caseInsensitiveCompare(preferred) == .orderedSame }) {
                return ContentLocaleResolution(locale: exact, matched: .exact)
            }
        }

        for preferred in preferredLanguages {
            let language = Self.languageSubtag(of: preferred)
            if let related = supported.first(where: { Self.languageSubtag(of: $0) == language }) {
                return ContentLocaleResolution(locale: related, matched: .language)
            }
        }

        return ContentLocaleResolution(locale: defaultLocale, matched: .fallback)
    }

    /// "ru-RU" and "ru_RU" both carry the language "ru". The underscore form is
    /// what `Locale.identifier` produces, and it reaches this type whenever a
    /// caller forwards a system value without converting it.
    static func languageSubtag(of tag: String) -> String {
        let separators = CharacterSet(charactersIn: "-_")
        let head = tag.components(separatedBy: separators).first ?? tag
        return head.lowercased()
    }
}

public struct ContentLocaleResolution: Hashable, Sendable {
    public enum Match: String, Hashable, Sendable {
        /// The requested locale is served as asked.
        case exact
        /// A regional variant is served by its language ("ru-RU" by "ru").
        case language
        /// Nothing the device asked for is published; the manifest default is
        /// used and the UI may say so.
        case fallback
    }

    public let locale: String
    public let matched: Match

    public init(locale: String, matched: Match) {
        self.locale = locale
        self.matched = matched
    }

    /// True when the user is not reading a language they asked for. The catalog
    /// uses it to explain the language rather than to hide the content.
    public var isFallback: Bool { matched == .fallback }
}

/// Picks the best name for a locale out of what an entity carries.
///
/// Entities keep every localized name they were published with, so the choice
/// happens at read time and the same stored record serves both languages.
public enum LocalizedNameSelection {
    public static func name(
        from names: [GeoNameRecord],
        locale: String,
        default defaultLocale: String
    ) -> String? {
        if let exact = names.first(where: { $0.locale.caseInsensitiveCompare(locale) == .orderedSame }) {
            return exact.value
        }

        let language = ContentLocaleResolver.languageSubtag(of: locale)
        if let related = names.first(where: { ContentLocaleResolver.languageSubtag(of: $0.locale) == language }) {
            return related.value
        }

        if let fallback = names.first(where: {
            $0.locale.caseInsensitiveCompare(defaultLocale) == .orderedSame
        }) {
            return fallback.value
        }

        // A primary name is the one the pipeline marks as canonical, so it is a
        // better last resort than whichever locale happens to sort first.
        return names.first(where: \.isPrimary)?.value ?? names.first?.value
    }
}
