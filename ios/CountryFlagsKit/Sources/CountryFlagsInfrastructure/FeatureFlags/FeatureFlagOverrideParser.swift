import Foundation

import CountryFlagsDomain

/// Reads flag overrides out of launch arguments.
///
/// A UI test needs to put the app into a known configuration without a backend.
/// The syntax is explicit rather than the `-key value` form, which Foundation
/// would also inject into `UserDefaults`:
///
///     -feature-flag study.multiple_choice.enabled=true
///
/// Only the app target calls this, and only inside `#if DEBUG` and outside the
/// production environment. A release build therefore contains no path from a
/// launch argument to a flag value. Parsing lives here rather than in the app
/// target so it can be tested; a package cannot make the decision itself,
/// because Xcode builds a local package in release for every configuration that
/// is not named "Debug".
public enum FeatureFlagOverrideParser {
    public static let argumentName = "-feature-flag"

    /// Values the registry does not accept are dropped: an override is a
    /// development affordance, not a way around the type of a key.
    public static func overrides(from arguments: [String]) -> [String: FeatureFlagValue] {
        var result: [String: FeatureFlagValue] = [:]
        var index = arguments.startIndex

        while index < arguments.endIndex {
            defer { index = arguments.index(after: index) }
            guard arguments[index] == argumentName else { continue }

            let valueIndex = arguments.index(after: index)
            guard valueIndex < arguments.endIndex else { break }
            index = valueIndex

            let assignment = arguments[valueIndex]
            guard let separator = assignment.firstIndex(of: "=") else { continue }
            let key = String(assignment[assignment.startIndex..<separator])
            let raw = String(assignment[assignment.index(after: separator)...])

            guard let value = parse(raw, forKey: key) else { continue }
            result[key] = value
        }

        return result
    }

    private static func parse(_ raw: String, forKey key: String) -> FeatureFlagValue? {
        guard let definition = FeatureFlagRegistry.definition(forKey: key) else { return nil }
        switch definition.type {
        case .boolean:
            switch raw {
            case "true": return .boolean(true)
            case "false": return .boolean(false)
            default: return nil
            }
        case .string:
            guard let flag = StringFeatureFlag(rawValue: key), flag.accepts(raw) else { return nil }
            return .string(raw)
        case .number:
            guard let number = Double(raw),
                let flag = NumberFeatureFlag(rawValue: key),
                flag.accepts(number)
            else { return nil }
            return .number(number)
        }
    }
}
