import Foundation
import HTTPTypes

import CountryFlagsDomain

// `UniversalClient.send` is behind the same SPI the generated client imports;
// the analytics batch is the one body this app serializes itself.
@_spi(Generated) import OpenAPIRuntime

/// The three telemetry endpoints: the analytics batch, the MetricKit report and
/// the privacy settings.
///
/// They live together because they are one policy seen from three sides — what
/// may be collected, what was collected, and what the account said about it.
public struct TelemetryService: AnalyticsBatchSending, DiagnosticsUploading, PrivacySettingsSyncing {
    private let clientFactory: APIClientFactory
    private let logger: any AppLogging

    public init(clientFactory: APIClientFactory, logger: any AppLogging = NoOpLogger()) {
        self.clientFactory = clientFactory
        self.logger = logger
    }

    // MARK: - Analytics batch

    /// Sends one batch and reports what the backend decided per event.
    ///
    /// The body is encoded from the envelopes rather than from a generated DTO
    /// — see `APIClientFactory.makeUniversalClient()` for why — but it goes
    /// through the same middlewares as everything else, so a 401 still
    /// refreshes and a 429 is still honoured.
    public func send(_ events: [AnalyticsEnvelope]) async throws -> AnalyticsBatchOutcome {
        guard !events.isEmpty else {
            return AnalyticsBatchOutcome(results: [], serverTime: Date())
        }
        let client = clientFactory.makeUniversalClient()
        do {
            return try await client.send(
                input: events,
                forOperation: "createAnalyticsBatch",
                serializer: { batch in
                    var request = HTTPRequest(
                        method: .post,
                        scheme: nil,
                        authority: nil,
                        path: "/v1/analytics/events/batch"
                    )
                    request.headerFields[.contentType] = "application/json"
                    request.headerFields[.accept] = "application/json"
                    let payload = AnalyticsBatchPayload(payloadVersion: 1, events: batch)
                    return (request, HTTPBody(try Self.encoder.encode(payload)))
                },
                deserializer: { response, body in
                    guard response.status.code == 200, let body else {
                        throw APIError.status(
                            APIErrorDetails(
                                statusCode: response.status.code,
                                code: "ANALYTICS_BATCH_REFUSED",
                                message: "The analytics batch was not accepted",
                                requestID: nil
                            )
                        )
                    }
                    let data = try await Data(collecting: body, upTo: 1024 * 1024)
                    let decoded = try Self.decoder.decode(BatchIngestionPayload.self, from: data)
                    return AnalyticsBatchOutcome(
                        results: decoded.results.compactMap(Self.result),
                        serverTime: decoded.serverTime
                    )
                }
            )
        } catch {
            throw APIError.from(error)
        }
    }

    // MARK: - Diagnostics

    /// Uploads one sanitized MetricKit report. The payload is already gzipped,
    /// base64-encoded and checksummed by the caller: this only carries it.
    public func upload(_ report: DiagnosticReportUpload) async throws {
        let output: Operations.createMetricKitReport.Output
        do {
            output = try await clientFactory.makeClient().createMetricKitReport(
                body: .json(
                    .init(
                        reportId: report.id.uuidString,
                        payloadVersion: ._1,
                        appVersion: report.appVersion,
                        build: report.build,
                        generatedAt: report.generatedAt,
                        encoding: .gzip_base64,
                        sha256: report.sha256,
                        payload: .init(report.payload)
                    )
                )
            )
        } catch {
            throw APIError.from(error).presentable
        }
        guard case .accepted = output else {
            // A refusal is final for this report: the payload will not become
            // acceptable by being sent again.
            throw APIError.status(
                APIErrorDetails(
                    statusCode: 0,
                    code: "DIAGNOSTICS_REFUSED",
                    message: "The diagnostics report was not accepted",
                    requestID: nil
                )
            ).presentable
        }
    }

    // MARK: - Privacy settings

    public func privacySettings() async throws -> TelemetryConsent {
        let output: Operations.getPrivacySettings.Output
        do {
            output = try await clientFactory.makeClient().getPrivacySettings()
        } catch {
            throw APIError.from(error).presentable
        }
        guard case .ok(let response) = output else { throw Self.unexpected.presentable }
        return try Self.consent(from: response.body.json)
    }

    /// Writes consent under the same optimistic concurrency the settings
    /// endpoint uses: the version the device read is what it offers back, and a
    /// refusal means another device answered first.
    public func update(_ consent: TelemetryConsent) async throws -> PrivacySettingsUpdateOutcome {
        let output: Operations.updatePrivacySettings.Output
        do {
            output = try await clientFactory.makeClient().updatePrivacySettings(
                headers: .init(If_hyphen_Match: Self.entityTag(forVersion: consent.version)),
                body: .json(
                    .init(
                        productAnalyticsStatus: .init(rawValue: consent.productAnalytics.rawValue),
                        diagnosticsStatus: .init(rawValue: consent.diagnostics.rawValue),
                        policyVersion: consent.policyVersion
                    )
                )
            )
        } catch {
            let mapped = APIError.from(error)
            if Self.isVersionConflict(mapped) {
                return .conflict(try? await privacySettings())
            }
            throw mapped.presentable
        }

        switch output {
        case .ok(let response):
            return .updated(try Self.consent(from: response.body.json))
        case .conflict:
            return .conflict(try? await privacySettings())
        default:
            throw Self.unexpected.presentable
        }
    }

    // MARK: - Mapping

    private static func consent(
        from payload: Components.Schemas.PrivacySettings
    ) throws -> TelemetryConsent {
        guard
            let product = ConsentStatus(rawValue: payload.productAnalyticsStatus.rawValue),
            let diagnostics = ConsentStatus(rawValue: payload.diagnosticsStatus.rawValue)
        else {
            // A status this build cannot read is treated as no answer at all,
            // which is the quiet side: nothing optional is collected under it.
            throw APIError.decoding("The privacy settings report a status this client cannot read")
        }
        return TelemetryConsent(
            productAnalytics: product,
            diagnostics: diagnostics,
            policyVersion: payload.policyVersion,
            version: payload.version,
            updatedAt: payload.updatedAt
        )
    }

    private static func result(
        _ payload: BatchIngestionPayload.Result
    ) -> AnalyticsIngestionResult? {
        guard let id = UUID(uuidString: payload.eventId),
            let status = AnalyticsIngestionStatus(rawValue: payload.status)
        else {
            // An identifier or a status this client cannot read leaves the
            // event queued rather than silently cleared.
            return nil
        }
        return AnalyticsIngestionResult(
            eventID: id,
            status: status,
            rejectionCode: payload.rejectionCode
        )
    }

    /// `W/"4"`, as the settings endpoints encode an integer version.
    static func entityTag(forVersion version: Int) -> String { "W/\"\(version)\"" }

    private static func isVersionConflict(_ error: APIError) -> Bool {
        switch error {
        case .conflict: true
        case .client(let details): details.statusCode == 412
        default: false
        }
    }

    private static var unexpected: APIError {
        APIError.status(
            APIErrorDetails(
                statusCode: 0,
                code: "UNKNOWN",
                message: "Unmapped telemetry response",
                requestID: nil
            )
        )
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}

/// The batch document, exactly as `batch.v1.schema.json` describes it.
private struct AnalyticsBatchPayload: Encodable {
    let payloadVersion: Int
    let events: [AnalyticsEnvelope]
}

private struct BatchIngestionPayload: Decodable {
    struct Result: Decodable {
        let eventId: String
        let status: String
        let rejectionCode: String?
    }

    let results: [Result]
    let serverTime: Date
}
