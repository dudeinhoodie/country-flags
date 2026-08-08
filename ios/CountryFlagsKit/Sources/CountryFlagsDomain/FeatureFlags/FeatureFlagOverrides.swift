import Foundation

/// Locally forced flag values.
///
/// A UI test needs to open a screen that is off by default, and a developer
/// needs to see one before it is rolled out. Neither may be possible in the
/// App Store build: the environment gate is the same one the debug badge uses,
/// because a local package is compiled in release for every configuration that
/// is not named "Debug" and `#if DEBUG` inside it would not follow the app.
public struct FeatureFlagOverrides: Hashable, Sendable {
    public static let launchArgument = "-feature-flag"

    public let values: [String: FeatureFlagValue]

    public init(values: [String: FeatureFlagValue] = [:]) {
        self.values = values
    }

    public static let none = FeatureFlagOverrides()

    /// Reads `-feature-flag <key>=<value>` pairs.
    ///
    /// Production ignores the arguments entirely rather than parsing and then
    /// discarding them: there is no path in a release build where an override
    /// exists at all.
    public static func fromLaunchArguments(
        _ arguments: [String],
        environment: AppEnvironment
    ) -> FeatureFlagOverrides {
        guard environment.allowsDebugAffordances else { return .none }

        var values: [String: FeatureFlagValue] = [:]
        var index = arguments.startIndex
        while index < arguments.endIndex {
            defer { index = arguments.index(after: index) }
            guard arguments[index] == launchArgument else { continue }

            let valueIndex = arguments.index(after: index)
            guard valueIndex < arguments.endIndex else { break }
            let pair = arguments[valueIndex]
            index = valueIndex

            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            guard parts.count == 2,
                let definition = FeatureFlagRegistry.definition(forKey: parts[0]),
                let value = parse(parts[1], as: definition.type),
                definition.accepts(value)
            else {
                continue
            }
            values[parts[0]] = value
        }
        return FeatureFlagOverrides(values: values)
    }

    private static func parse(_ raw: String, as type: FeatureFlagValueType) -> FeatureFlagValue? {
        switch type {
        case .boolean:
            switch raw.lowercased() {
            case "true", "1", "yes": return .boolean(true)
            case "false", "0", "no": return .boolean(false)
            default: return nil
            }
        case .string:
            return raw.isEmpty ? nil : .string(raw)
        case .number:
            return Double(raw).map(FeatureFlagValue.number)
        }
    }
}
