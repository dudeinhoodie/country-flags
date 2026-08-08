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
            deepLinkScheme: scheme
        )
    }

    public static func configuration(from bundle: Bundle) throws -> RuntimeConfiguration {
        try configuration(from: bundle.infoDictionary ?? [:])
    }
}
