import Foundation

/// The source of the current instant. A test substitutes a fixed value for the
/// system clock.
public protocol DateProviding: Sendable {
    func now() -> Date
}

/// The source of new identifiers. A review event is assigned its UUID before
/// the next card is shown, so the generator has to be substitutable in tests.
public protocol IdentifierProviding: Sendable {
    func next() -> UUID
}

public struct SystemDateProvider: DateProviding {
    public init() {}

    public func now() -> Date {
        Date()
    }
}

public struct SystemIdentifierProvider: IdentifierProviding {
    public init() {}

    public func next() -> UUID {
        UUID()
    }
}
