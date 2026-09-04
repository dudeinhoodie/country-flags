import Foundation

import CountryFlagsDomain

/// Reads the configuration from Info.plist, where the selected xcconfig puts
/// it.
///
/// Missing and unknown values are handled explicitly: an unrecognized
/// environment must never silently become production.
public enum RuntimeConfigurationLoader {
    public enum LoadError: Error, Equatable, Sendable {
        case missingKey(String)
        case unknownEnvironment(String)
        case invalidURL(String)
    }

    public static let environmentKey = "CFAppEnvironment"
    public static let apiBaseURLKey = "CFAPIBaseURL"
    public static let deepLinkSchemeKey = "CFDeepLinkScheme"
    public static let googleClientIDKey = "CFGoogleClientID"
    public static let googleServerClientIDKey = "CFGoogleServerClientID"
    public static let privacyPolicyURLKey = "CFPrivacyPolicyURL"
    public static let termsURLKey = "CFTermsURL"
    public static let versionKey = "CFBundleShortVersionString"
    public static let buildKey = "CFBundleVersion"

    public static func configuration(
        from values: [String: Any]
    ) throws -> RuntimeConfiguration {
        guard let rawEnvironment = values[environmentKey] as? String else {
            throw LoadError.missingKey(environmentKey)
        }
        guard let environment = AppEnvironment(rawValue: rawEnvironment.lowercased()) else {
            throw LoadError.unknownEnvironment(rawEnvironment)
        }
        guard let scheme = values[deepLinkSchemeKey] as? String, !scheme.isEmpty else {
            throw LoadError.missingKey(deepLinkSchemeKey)
        }

        // Mock runs without a backend, so an empty base URL is valid there.
        let rawURL = (values[apiBaseURLKey] as? String) ?? ""
        let apiBaseURL: URL?
        if rawURL.isEmpty {
            guard environment == .mock else {
                throw LoadError.missingKey(apiBaseURLKey)
            }
            apiBaseURL = nil
        } else {
            guard let url = URL(string: rawURL), url.scheme != nil else {
                throw LoadError.invalidURL(rawURL)
            }
            apiBaseURL = url
        }

        return RuntimeConfiguration(
            environment: environment,
            apiBaseURL: apiBaseURL,
            deepLinkScheme: scheme,
            // Optional on purpose: a build without console credentials is a
            // build without a Google button, not a broken one.
            googleClientID: nonEmpty(values[googleClientIDKey]),
            googleServerClientID: nonEmpty(values[googleServerClientIDKey]),
            // Optional for the same reason. An address that is present but
            // unreadable is a configuration mistake rather than an absent
            // document, so it fails the load rather than hiding the link.
            privacyPolicyURL: try legalURL(nonEmpty(values[privacyPolicyURLKey])),
            termsURL: try legalURL(nonEmpty(values[termsURLKey])),
            appVersion: nonEmpty(values[versionKey]) ?? "0",
            appBuild: nonEmpty(values[buildKey]) ?? "0"
        )
    }

    private static func nonEmpty(_ value: Any?) -> String? {
        guard let string = value as? String, !string.isEmpty else { return nil }
        return string
    }

    /// An address that was configured has to be usable; one that was not is
    /// simply a document this build does not link to.
    private static func legalURL(_ raw: String?) throws -> URL? {
        guard let raw else { return nil }
        guard let url = URL(string: raw), url.scheme != nil else {
            throw LoadError.invalidURL(raw)
        }
        return url
    }

    public static func configuration(from bundle: Bundle) throws -> RuntimeConfiguration {
        try configuration(from: bundle.infoDictionary ?? [:])
    }
}
