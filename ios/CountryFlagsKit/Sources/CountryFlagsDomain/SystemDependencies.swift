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

/// A pause between two attempts at the same question.
///
/// Declared as a dependency rather than called inline so a state machine that
/// polls — the data export is the one that does — can be driven through every
/// state in a test without spending the seconds.
public protocol Waiting: Sendable {
    func wait(seconds: TimeInterval) async
}

public struct TaskWaiter: Waiting {
    public init() {}

    public func wait(seconds: TimeInterval) async {
        // A cancelled wait simply returns: the caller checks cancellation for
        // itself, and a throw here would turn "stop polling" into an error.
        try? await Task.sleep(for: .seconds(seconds))
    }
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
