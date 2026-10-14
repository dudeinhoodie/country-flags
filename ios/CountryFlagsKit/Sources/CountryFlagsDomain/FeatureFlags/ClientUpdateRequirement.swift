import Foundation

/// What the running build has to do about the backend's version policy
/// (#447).
public enum ClientUpdateRequirement: Hashable, Sendable {
    /// Nothing: the build is current, or the backend asks for nothing.
    case none
    /// A newer build exists and the backend suggests it. The app stays open.
    case recommended(latest: String)
    /// The backend no longer supports this build. The app stops at the update
    /// screen until it is updated.
    case required(minimumSupported: String)
}

/// Where the backend's version policy is read from.
///
/// Its own protocol rather than a method on the flag provider: the policy is
/// not a flag, has no default and no activation policy, and only the root of
/// the app asks for it.
public protocol ClientVersionPolicyProviding: Sendable {
    /// The policy of the snapshot currently answering, cached or fresh. Nil
    /// before there has been one.
    var clientVersionPolicy: ClientVersionPolicy? { get }
}

extension ClientVersionPolicy {
    /// What the policy asks of a build with this version.
    ///
    /// The update mode is the backend's instruction, so it decides:
    ///
    /// - `NONE` asks for nothing, whatever the numbers say. The backend sends
    ///   `NONE` with placeholder versions while it has no policy, and a build
    ///   below a placeholder must not lock itself out;
    /// - `SOFT` recommends the latest build and never blocks;
    /// - `FORCED` blocks a build below `minimumSupported` and recommends the
    ///   latest build to one above it.
    ///
    /// A version that cannot be read on either side asks for nothing. The gate
    /// can only ever stop the app, and a malformed number is not a reason to.
    public func requirement(forAppVersion appVersion: String) -> ClientUpdateRequirement {
        guard let running = ClientVersionNumber(appVersion) else { return .none }
        let isBelowLatest = ClientVersionNumber(latest).map { running < $0 } ?? false
        switch updateMode {
        case .none:
            return .none
        case .soft:
            return isBelowLatest ? .recommended(latest: latest) : .none
        case .forced:
            if let minimum = ClientVersionNumber(minimumSupported), running < minimum {
                return .required(minimumSupported: minimumSupported)
            }
            return isBelowLatest ? .recommended(latest: latest) : .none
        }
    }
}

/// A `major.minor.patch` version, compared numerically.
///
/// The contract writes the policy as three numbers. The build's own version
/// may leave the patch out ("1.2"), which reads as zero; anything with a
/// suffix or a fourth part is not a version this gate compares.
struct ClientVersionNumber: Comparable, Sendable {
    let components: [Int]

    init?(_ text: String) {
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard (1...3).contains(parts.count) else { return nil }
        var numbers: [Int] = []
        for part in parts {
            guard !part.isEmpty, part.allSatisfy(\.isASCII), part.allSatisfy(\.isNumber),
                let number = Int(part)
            else { return nil }
            numbers.append(number)
        }
        components = numbers + Array(repeating: 0, count: 3 - numbers.count)
    }

    static func < (left: Self, right: Self) -> Bool {
        left.components.lexicographicallyPrecedes(right.components)
    }
}
