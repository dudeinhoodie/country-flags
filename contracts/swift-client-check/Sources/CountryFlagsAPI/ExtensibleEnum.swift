import Foundation

/// Reference implementation of the extensible-enum rule documented in
/// `contracts/README.md`.
///
/// Fields carrying `x-extensible-enum` are generated as `String`, so the client
/// owns the mapping. Wrapping the raw value keeps an unknown taxonomy value
/// addressable — the surrounding payload still decodes and only the affected UI
/// element degrades.
public enum ExtensibleEnum<Known>: Sendable, Hashable
where Known: RawRepresentable & Sendable & Hashable, Known.RawValue == String {
    case known(Known)
    case unknown(String)

    public init(rawValue: String) {
        if let known = Known(rawValue: rawValue) {
            self = .known(known)
        } else {
            self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .known(let value): return value.rawValue
        case .unknown(let value): return value
        }
    }

    /// The known value, or nil when the server sent something newer than this
    /// build understands.
    public var knownValue: Known? {
        switch self {
        case .known(let value): return value
        case .unknown: return nil
        }
    }
}

/// Values of `Deck.kind` known at the time of this contract revision.
public enum DeckKind: String, Sendable, Hashable, CaseIterable {
    case curated = "CURATED"
    case taxonomy = "TAXONOMY"
    case dynamicUser = "DYNAMIC_USER"
    case custom = "CUSTOM"
}

/// Values of `GeoEntity.kind` known at the time of this contract revision.
public enum GeoEntityKind: String, Sendable, Hashable, CaseIterable {
    case country = "COUNTRY"
    case territory = "TERRITORY"
    case dependency = "DEPENDENCY"
    case disputedArea = "DISPUTED_AREA"
    case region = "REGION"
    case subregion = "SUBREGION"
    case other = "OTHER"
}

/// Values of `ContentChange.resourceType` known at the time of this contract
/// revision.
public enum ContentResourceType: String, Sendable, Hashable, CaseIterable {
    case entity = "ENTITY"
    case deck = "DECK"
    case learningCard = "LEARNING_CARD"
    case asset = "ASSET"
    case fact = "FACT"
}
