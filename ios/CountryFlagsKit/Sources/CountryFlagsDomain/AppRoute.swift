import Foundation

/// A typed navigation route.
///
/// Screens are addressed by values, not by strings: a deep link is parsed into
/// an `AppRoute` before the UI sees it, so a typo in a path cannot turn into a
/// screen that does not exist.
public enum AppRoute: Hashable, Sendable {
    case catalog
    case deck(id: UUID)
    /// A study session for a deck. It carries the size because the session's
    /// composition is fixed when it starts, and the screen must not have to ask
    /// the settings again halfway through.
    case study(deckID: UUID, size: StudySessionSize)
    case progress
    case settings
}

/// Parses an incoming URL into a route. It lives in Domain because it depends
/// on nothing from SwiftUI and is fully covered by unit tests.
public struct DeepLinkParser: Sendable {
    /// The scheme the app registers; it comes from the build configuration.
    public let scheme: String

    public init(scheme: String) {
        self.scheme = scheme
    }

    public func route(for url: URL) -> AppRoute? {
        guard url.scheme?.lowercased() == scheme.lowercased() else {
            return nil
        }

        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        // The host carries the section and the path carries the resource id:
        // countryflags://deck/<uuid>
        let segments = [components?.host].compactMap { $0 }
            + (components?.path.split(separator: "/").map(String.init) ?? [])

        switch segments.first?.lowercased() {
        case "catalog":
            return segments.count == 1 ? .catalog : nil
        case "deck":
            guard segments.count == 2, let id = UUID(uuidString: segments[1]) else {
                return nil
            }
            return .deck(id: id)
        case "progress":
            return segments.count == 1 ? .progress : nil
        case "settings":
            return segments.count == 1 ? .settings : nil
        default:
            return nil
        }
    }
}
