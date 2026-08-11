import Foundation

/// A mastery tier as the server defines it.
///
/// The thresholds and the ladder are the server's decision and this client only
/// displays the result — it never recomputes which tier a learner is on. That
/// is why an unrecognised value is a case rather than a failure: a release that
/// adds a tier must not blank the progress screen of a build that predates it,
/// and the contract declares the enum extensible for the same reason.
public enum MasteryTier: Hashable, Sendable {
    case none
    case bronze
    case silver
    case gold
    case platinum
    /// A tier this build does not know, carried so it can still be shown.
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue.uppercased() {
        case "NONE": self = .none
        case "BRONZE": self = .bronze
        case "SILVER": self = .silver
        case "GOLD": self = .gold
        case "PLATINUM": self = .platinum
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .none: "NONE"
        case .bronze: "BRONZE"
        case .silver: "SILVER"
        case .gold: "GOLD"
        case .platinum: "PLATINUM"
        case .unknown(let value): value
        }
    }

    /// Whether this build has a name and a look for the tier. A caller that
    /// draws an emblem needs to know; one that only prints the value does not.
    public var isKnown: Bool {
        if case .unknown = self { return false }
        return true
    }

    /// Whether the tier represents any mastery at all, which is what decides
    /// between showing an emblem and showing nothing yet.
    public var isEarned: Bool {
        switch self {
        case .none: false
        // An unknown tier is treated as earned: the server only reports one
        // the learner reached, and hiding it would lose the achievement.
        default: true
        }
    }

    /// The ladder this build knows, in order, for a screen that shows what
    /// comes next. An unknown tier is deliberately absent: its place in the
    /// ladder is not something the client may guess.
    public static let ladder: [MasteryTier] = [.bronze, .silver, .gold, .platinum]
}
