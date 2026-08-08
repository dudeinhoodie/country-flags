import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

final class PresentableErrorTests: XCTestCase {
    /// The identifier support needs survives; the server prose does not. An
    /// error envelope is written for an operator and can name an internal rule,
    /// a provider or a record.
    func testServerMessageIsDroppedAndTheRequestIdentifierIsKept() {
        let error = APIError.server(
            APIErrorDetails(
                statusCode: 500,
                code: "INTERNAL_ERROR",
                message: "user person@example.com failed rule targeting_v3 on shard 7",
                requestID: "3f1c0f4e-6d2b-4a5e-9b13-000000000001"
            )
        )

        let presentable = error.presentable

        XCTAssertEqual(presentable.kind, .server)
        XCTAssertEqual(presentable.code, "INTERNAL_ERROR")
        XCTAssertEqual(presentable.supportRequestID, "3f1c0f4e-6d2b-4a5e-9b13-000000000001")
        // There is no field the message could have been carried in.
        XCTAssertFalse(String(describing: presentable).contains("person@example.com"))
        XCTAssertFalse(String(describing: presentable).contains("targeting_v3"))
    }

    func testEachStatusMapsToACopyKind() {
        let cases: [(APIError, PresentableError.Kind)] = [
            (.unauthorized(details(401, "UNAUTHORIZED")), .unauthorized),
            (.forbidden(details(403, "FORBIDDEN")), .forbidden),
            (.forbidden(details(403, "FEATURE_DISABLED")), .featureDisabled),
            (.notFound(details(404, "NOT_FOUND")), .notFound),
            (.conflict(details(409, "CONFLICT")), .conflict),
            (.validationFailed(details(422, "VALIDATION_FAILED")), .invalidInput),
            (.rateLimited(details(429, "RATE_LIMITED"), retryAfter: nil), .rateLimited),
            (.server(details(500, "INTERNAL_ERROR")), .server),
            (.client(details(418, "TEAPOT")), .unexpected),
            (.decoding("DecodingError"), .unexpected),
            (.transport(String(URLError.notConnectedToInternet.rawValue)), .offline),
            (.transport(String(URLError.timedOut.rawValue)), .timeout),
        ]

        for (error, expected) in cases {
            XCTAssertEqual(error.presentable.kind, expected, String(describing: error))
        }
    }

    /// A kill switch reads as "temporarily unavailable", not as a problem with
    /// the person's account.
    func testDisabledFeatureIsNotShownAsAPermissionProblem() {
        let error = APIError.forbidden(details(403, "FEATURE_DISABLED"))

        XCTAssertEqual(error.presentable.kind, .featureDisabled)
        XCTAssertNotEqual(error.presentable.kind, .forbidden)
    }

    private func details(_ statusCode: Int, _ code: String) -> APIErrorDetails {
        APIErrorDetails(
            statusCode: statusCode,
            code: code,
            message: "Test failure",
            requestID: "3f1c0f4e-6d2b-4a5e-9b13-000000000002"
        )
    }
}

final class GuestScopeProviderTests: XCTestCase {
    /// The identifier is created once and found again, or the guest's progress
    /// is orphaned on the next launch.
    func testInstallationIdentifierIsCreatedOnceAndReused() async {
        let tokens = InMemoryTokenStore()
        let provider = GuestScopeProvider(tokens: tokens)

        let first = await provider.currentScope()
        let second = await provider.currentScope()

        XCTAssertEqual(first, second)
        XCTAssertTrue(first.isGuest)
        let stored = try? await tokens.value(for: .installationID)
        XCTAssertNotNil(stored ?? nil)
    }

    /// A keychain that cannot answer still yields a usable scope, and says so.
    func testUnavailableKeychainStillYieldsAScope() async {
        let logger = RecordingLogger()
        let provider = GuestScopeProvider(
            tokens: FailingTokenStore(),
            logger: logger
        )

        let scope = await provider.currentScope()

        XCTAssertTrue(scope.isGuest)
        XCTAssertEqual(logger.recorded.count, 1)
        XCTAssertEqual(logger.recorded.first?.level, .error)
    }
}

/// A token store that keeps values in memory.
private actor InMemoryTokenStore: SecureTokenStoring {
    private var values: [SecureTokenKind: String] = [:]

    func value(for kind: SecureTokenKind) async throws -> String? {
        values[kind]
    }

    func setValue(_ value: String?, for kind: SecureTokenKind) async throws {
        values[kind] = value
    }

    func removeAll() async throws {
        values.removeAll()
    }
}

private struct FailingTokenStore: SecureTokenStoring {
    func value(for kind: SecureTokenKind) async throws -> String? {
        throw SecureTokenStoreError.unavailable(status: -25308)
    }

    func setValue(_ value: String?, for kind: SecureTokenKind) async throws {
        throw SecureTokenStoreError.unavailable(status: -25308)
    }

    func removeAll() async throws {
        throw SecureTokenStoreError.unavailable(status: -25308)
    }
}
