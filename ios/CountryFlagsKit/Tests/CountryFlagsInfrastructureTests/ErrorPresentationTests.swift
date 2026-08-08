import Foundation
import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

final class ErrorPresentationTests: XCTestCase {
    private let requestID = "1D0E9B8C-0000-4000-8000-000000000001"

    private func details(
        statusCode: Int,
        code: String,
        message: String = "Something went wrong"
    ) -> APIErrorDetails {
        APIErrorDetails(
            statusCode: statusCode,
            code: code,
            message: message,
            requestID: requestID
        )
    }

    /// A server message is written for an operator, is not localized and can
    /// quote a payload. It must not become the text on the screen.
    func testTheServerMessageNeverReachesThePresentation() {
        let error = APIError.server(
            details(
                statusCode: 500,
                code: "INTERNAL_ERROR",
                message: "user learner@example.com failed on shard 4"
            )
        )

        let presentation = error.presentation

        XCTAssertEqual(presentation.kind, .serverUnavailable)
        let mirror = Mirror(reflecting: presentation)
        XCTAssertEqual(
            Set(mirror.children.compactMap(\.label)),
            ["kind", "supportRequestID", "isRetryable"]
        )
    }

    func testThePresentationCarriesTheSupportRequestIdentifier() {
        XCTAssertEqual(
            APIError.server(details(statusCode: 503, code: "SERVICE_UNAVAILABLE"))
                .presentation
                .supportRequestID,
            requestID
        )
    }

    func testEachFailureMapsToAnActionableKind() {
        XCTAssertEqual(
            APIError.unauthorized(details(statusCode: 401, code: "UNAUTHORIZED")).presentation.kind,
            .signInRequired
        )
        XCTAssertEqual(
            APIError.notFound(details(statusCode: 404, code: "NOT_FOUND")).presentation.kind,
            .contentUnavailable
        )
        XCTAssertEqual(APIError.transport("-1009").presentation.kind, .offline)
        XCTAssertEqual(
            APIError.forbidden(details(statusCode: 403, code: "FEATURE_DISABLED"))
                .presentation
                .kind,
            .featureUnavailable
        )
        XCTAssertEqual(
            APIError.forbidden(details(statusCode: 403, code: "FORBIDDEN")).presentation.kind,
            .unexpected
        )
    }

    func testOnlyTransientFailuresAreOfferedARetry() {
        XCTAssertTrue(APIError.transport("-1009").presentation.isRetryable)
        XCTAssertTrue(
            APIError.server(details(statusCode: 500, code: "INTERNAL_ERROR"))
                .presentation
                .isRetryable
        )
        XCTAssertFalse(
            APIError.validationFailed(details(statusCode: 422, code: "VALIDATION_FAILED"))
                .presentation
                .isRetryable
        )
    }

    /// The context an error report is built from holds machine-readable values
    /// only: a status, a registered code and the request identifier.
    func testTheErrorContextCarriesNoFreeText() {
        let error = APIError.server(
            details(
                statusCode: 500,
                code: "INTERNAL_ERROR",
                message: "learner@example.com is not allowed"
            )
        )

        let context = error.errorContext(
            operation: "getAppConfig",
            endpointTemplate: "/v1/app-config"
        )

        XCTAssertEqual(context.operation, "getAppConfig")
        XCTAssertEqual(context.endpointTemplate, "/v1/app-config")
        XCTAssertEqual(context.errorCode, "INTERNAL_ERROR")
        XCTAssertEqual(context.statusCode, 500)
        XCTAssertEqual(context.requestID, requestID)

        let rendered = String(describing: context)
        XCTAssertFalse(rendered.contains("learner@example.com"))
    }
}

final class OSLogAppLoggerTests: XCTestCase {
    /// A release build stops below `notice`, so development tracing cannot ship.
    func testTheReleaseThresholdExcludesDebugAndInfo() {
        XCTAssertTrue(LogLevel.debug < OSLogAppLogger.releaseMinimumLevel)
        XCTAssertTrue(LogLevel.info < OSLogAppLogger.releaseMinimumLevel)
        XCTAssertFalse(LogLevel.error < OSLogAppLogger.releaseMinimumLevel)
    }

    /// The adapter writes to the unified log, which a test cannot read back.
    /// What is checkable is that it accepts every level and category without
    /// failing, and that the entries it is handed are already redacted.
    func testEveryCategoryAndLevelIsAccepted() {
        let logger = OSLogAppLogger(subsystem: "app.countryflags.tests", minimumLevel: .debug)

        for category in LogCategory.allCases {
            for level in LogLevel.allCases {
                logger.log(
                    LogEvent(
                        category: category,
                        level: level,
                        event: "test.event",
                        requestID: "1D0E9B8C-0000-4000-8000-000000000001",
                        fields: ["code": "OK"]
                    )
                )
            }
        }
    }
}
