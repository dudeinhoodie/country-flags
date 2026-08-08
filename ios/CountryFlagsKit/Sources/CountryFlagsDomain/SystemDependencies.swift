import Foundation

/// Источник текущего времени. Тест подставляет фиксированное значение вместо
/// системных часов.
public protocol DateProviding: Sendable {
    func now() -> Date
}

/// Источник новых идентификаторов. Review event получает UUID до показа
/// следующей карточки, поэтому генератор должен быть заменяемым в тестах.
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
