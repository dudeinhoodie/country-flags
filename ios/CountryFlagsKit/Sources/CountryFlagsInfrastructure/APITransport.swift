import Foundation

/// Границы сетевого слоя. Реализация поверх `URLSession` и сгенерированный
/// OpenAPI-клиент появляются в IOS-002; здесь фиксируется только точка
/// подмены, чтобы feature-код с самого начала зависел от протокола.
public protocol APITransport: Sendable {
    func send(_ request: APIRequest) async throws -> APIResponse
}

public struct APIRequest: Hashable, Sendable {
    public let method: String
    public let path: String

    public init(method: String = "GET", path: String) {
        self.method = method
        self.path = path
    }
}

public struct APIResponse: Hashable, Sendable {
    public let statusCode: Int
    public let body: Data

    public init(statusCode: Int, body: Data) {
        self.statusCode = statusCode
        self.body = body
    }
}

public enum APITransportError: Error, Equatable, Sendable {
    /// Транспорт ещё не собран для этой конфигурации.
    case notConfigured
    /// Mock-транспорт не знает такого запроса.
    case unhandled(APIRequest)
}

/// Транспорт по умолчанию для Dev и Prod до IOS-002.
///
/// Осознанно бросает ошибку вместо возврата пустого успеха: молчаливый
/// placeholder-успех скрыл бы незавершённую работу от вызывающего кода.
public struct UnconfiguredAPITransport: APITransport {
    public init() {}

    public func send(_ request: APIRequest) async throws -> APIResponse {
        _ = request
        throw APITransportError.notConfigured
    }
}

/// Детерминированный транспорт для схемы Mock и тестов: отвечает только
/// заранее заданными payload и никогда не обращается к сети.
public struct MockAPITransport: APITransport {
    private let responses: [APIRequest: APIResponse]

    public init(responses: [APIRequest: APIResponse] = [:]) {
        self.responses = responses
    }

    public func send(_ request: APIRequest) async throws -> APIResponse {
        guard let response = responses[request] else {
            throw APITransportError.unhandled(request)
        }
        return response
    }
}
