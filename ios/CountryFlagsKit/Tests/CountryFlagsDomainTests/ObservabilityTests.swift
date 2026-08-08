import Foundation
import XCTest

import CountryFlagsDomain

/// Canary values. If any of them survives into something a logger or a reporter
/// is handed, the redaction has a hole.
private enum Canary {
    static let accessToken =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    static let authorizationHeader = "Authorization: Bearer sk-live-not-a-real-secret"
    static let email = "learner@example.com"
}

final class RedactionTests: XCTestCase {
    func testAJsonWebTokenIsMasked() {
        let redacted = Redaction.redact("token=\(Canary.accessToken) end")

        XCTAssertFalse(redacted.contains(Canary.accessToken))
        XCTAssertTrue(redacted.contains(Redaction.placeholder))
    }

    func testAnAuthorizationHeaderIsMasked() {
        let redacted = Redaction.redact(Canary.authorizationHeader)

        XCTAssertFalse(redacted.localizedCaseInsensitiveContains("sk-live"))
    }

    func testAnEmailAddressIsMasked() {
        let redacted = Redaction.redact("signed in as \(Canary.email)")

        XCTAssertFalse(redacted.contains(Canary.email))
    }

    func testADeniedFieldNameIsDroppedWhateverItHolds() {
        let redacted = Redaction.redact(fields: ["refreshToken": "opaque-value-42"])

        XCTAssertEqual(redacted["refreshToken"], Redaction.placeholder)
    }

    func testFieldNamesAreMatchedRegardlessOfSpelling() {
        for name in [
            "Authorization", "authorization", "auth_token", "X-Auth-Token",
            "sessionToken", "Set-Cookie", "emailAddress", "providerSubject",
        ] {
            XCTAssertTrue(Redaction.isDenied(fieldName: name), name)
        }
    }

    func testAnUnrelatedFieldNameIsNotDenied() {
        for name in ["status", "operation", "code", "durationMs", "deckId"] {
            XCTAssertFalse(Redaction.isDenied(fieldName: name), name)
        }
    }

    func testAnInnocentFieldNameStillHasItsValueRedacted() {
        let redacted = Redaction.redact(fields: ["note": "sent \(Canary.accessToken)"])

        XCTAssertFalse(try XCTUnwrap(redacted["note"]).contains(Canary.accessToken))
    }

    func testASafeValueIsLeftAlone() {
        let redacted = Redaction.redact(fields: ["status": "503", "operation": "getAppConfig"])

        XCTAssertEqual(redacted["status"], "503")
        XCTAssertEqual(redacted["operation"], "getAppConfig")
    }
}

final class LogEventTests: XCTestCase {
    func testALogEventRedactsItsFieldsOnConstruction() {
        let event = LogEvent(
            category: .auth,
            level: .error,
            event: "auth.refresh_failed",
            requestID: "1D0E9B8C-0000-4000-8000-000000000001",
            fields: [
                "accessToken": Canary.accessToken,
                "email": Canary.email,
                "code": "REFRESH_REJECTED",
            ]
        )

        XCTAssertFalse(event.renderedFields.contains(Canary.accessToken))
        XCTAssertFalse(event.renderedFields.contains(Canary.email))
        XCTAssertTrue(event.renderedFields.contains("code=REFRESH_REJECTED"))
    }

    func testTheRequestIdentifierSurvivesForSupport() {
        let event = LogEvent(
            category: .network,
            level: .error,
            event: "request.failed",
            requestID: "1D0E9B8C-0000-4000-8000-000000000001"
        )

        XCTAssertEqual(event.requestID, "1D0E9B8C-0000-4000-8000-000000000001")
    }

    func testFieldsAreRenderedInAStableOrder() {
        let event = LogEvent(
            category: .sync,
            level: .info,
            event: "sync.completed",
            fields: ["b": "2", "a": "1", "c": "3"]
        )

        XCTAssertEqual(event.renderedFields, "a=1 b=2 c=3")
    }

    func testTheConvenienceHelperReachesTheAdapter() {
        let logger = RecordingAppLogger()

        logger.log(.notice, "snapshot.refresh_failed", category: .featureFlags)

        XCTAssertEqual(logger.events.map(\.event), ["snapshot.refresh_failed"])
        XCTAssertEqual(logger.events.map(\.category), [.featureFlags])
    }

    func testABreadcrumbRedactsItsFields() {
        let breadcrumb = SafeBreadcrumb(
            category: .network,
            event: "request.sent",
            occurredAt: PolicyFixtures.instant,
            fields: ["authorization": Canary.authorizationHeader]
        )

        XCTAssertEqual(breadcrumb.fields["authorization"], Redaction.placeholder)
    }
}

final class ObservabilityDefaultsTests: XCTestCase {
    /// Telemetry must never be the reason an operation fails or stalls. The
    /// defaults are the shape that guarantees it.
    func testTheDefaultAdaptersDoNothingAndReturn() async {
        let analytics = NoOpAnalyticsTracker()
        await analytics.setIdentity(AnalyticsIdentity(analyticsSubjectID: UUID()))
        await analytics.track(
            AnalyticsEvent(
                id: UUID(),
                name: .studySessionCompleted,
                occurredAt: PolicyFixtures.instant
            )
        )
        await analytics.flush()

        let diagnostics = NoOpDiagnosticsReporter()
        await diagnostics.report(
            DiagnosticReport(
                id: UUID(),
                kind: .crash,
                capturedAt: PolicyFixtures.instant,
                appBuild: "42",
                payload: Data()
            )
        )
        await diagnostics.reset()

        let reporter = NoOpErrorReporter()
        reporter.setUserContext(ErrorUserContext(analyticsSubjectID: UUID()))
        reporter.capture(
            error: URLError(.notConnectedToInternet),
            context: ErrorContext(category: .network, operation: "getAppConfig")
        )
        reporter.setUserContext(nil)
    }

    func testOperationalEventsAreSeparatedFromProductEvents() {
        XCTAssertTrue(AnalyticsEventName.syncCompleted.isOperational)
        XCTAssertTrue(AnalyticsEventName.contentUpdateCompleted.isOperational)
        XCTAssertFalse(AnalyticsEventName.studySessionCompleted.isOperational)
        XCTAssertEqual(
            AnalyticsEventName.studySessionCompleted.consentCategory,
            .productAnalytics
        )
    }

    func testUnknownConsentDoesNotAllowOptionalProcessing() {
        XCTAssertFalse(ConsentStatus.unknown.allowsOptionalProcessing)
        XCTAssertFalse(ConsentStatus.denied.allowsOptionalProcessing)
        XCTAssertTrue(ConsentStatus.granted.allowsOptionalProcessing)
        XCTAssertTrue(ConsentStatus.notRequired.allowsOptionalProcessing)
    }
}

final class FeatureExposureRecorderTests: XCTestCase {
    private func makeRecorder() -> (FeatureExposureRecorder, RecordingExposureReporter) {
        let reporter = RecordingExposureReporter()
        return (
            FeatureExposureRecorder(reporter: reporter, dates: TestClock()),
            reporter
        )
    }

    /// Reading a flag is not an exposure: a screen may evaluate the same key on
    /// every redraw, and one event per read would make the denominator useless.
    func testTheSameVariantOnTheSameSurfaceIsReportedOnce() async {
        let (recorder, reporter) = makeRecorder()

        for _ in 0..<5 {
            await recorder.recordExposure(
                flagKey: StringFeatureFlag.homeRecommendedDecksVariant.key,
                variant: "personalized",
                configVersion: "config-1",
                surface: .home
            )
        }

        let exposures = await reporter.recorded()
        XCTAssertEqual(exposures.count, 1)
        XCTAssertEqual(exposures.first?.variant, "personalized")
        XCTAssertEqual(exposures.first?.surface, .home)
    }

    func testAnotherSurfaceIsAnotherExposure() async {
        let (recorder, reporter) = makeRecorder()

        await recorder.recordExposure(
            flagKey: StringFeatureFlag.homeRecommendedDecksVariant.key,
            variant: "control",
            configVersion: "config-1",
            surface: .home
        )
        await recorder.recordExposure(
            flagKey: StringFeatureFlag.homeRecommendedDecksVariant.key,
            variant: "control",
            configVersion: "config-1",
            surface: .catalog
        )

        let exposures = await reporter.recorded()
        XCTAssertEqual(exposures.count, 2)
    }

    /// A new configuration may carry a new assignment, so it re-arms the event.
    func testANewConfigurationVersionIsReportedAgain() async {
        let (recorder, reporter) = makeRecorder()

        await recorder.recordExposure(
            flagKey: StringFeatureFlag.homeRecommendedDecksVariant.key,
            variant: "control",
            configVersion: "config-1",
            surface: .home
        )
        await recorder.recordExposure(
            flagKey: StringFeatureFlag.homeRecommendedDecksVariant.key,
            variant: "control",
            configVersion: "config-2",
            surface: .home
        )

        let exposures = await reporter.recorded()
        XCTAssertEqual(exposures.map(\.configVersion), ["config-1", "config-2"])
    }

    func testResettingStartsANewAssignmentHistory() async {
        let (recorder, reporter) = makeRecorder()

        await recorder.recordExposure(
            flagKey: StringFeatureFlag.homeRecommendedDecksVariant.key,
            variant: "control",
            configVersion: "config-1",
            surface: .home
        )
        await recorder.reset()
        await recorder.recordExposure(
            flagKey: StringFeatureFlag.homeRecommendedDecksVariant.key,
            variant: "control",
            configVersion: "config-1",
            surface: .home
        )

        let exposures = await reporter.recorded()
        XCTAssertEqual(exposures.count, 2)
    }
}
