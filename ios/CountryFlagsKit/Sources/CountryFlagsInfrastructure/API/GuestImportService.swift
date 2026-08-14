import Foundation
import OpenAPIRuntime

import CountryFlagsDomain

/// Carries a guest archive to the backend and reads back what it decided.
///
/// The records cross the wire exactly as the store holds them — the same
/// identifiers, the same timestamps — because the whole safety of the import
/// rests on the backend recognising work it has already taken.
public struct GuestImportService: GuestImportSubmitting {
    private let clientFactory: APIClientFactory

    public init(clientFactory: APIClientFactory) {
        self.clientFactory = clientFactory
    }

    public func submit(_ payload: GuestImportPayload) async throws -> GuestImportResultRecord {
        let client = clientFactory.makeClient()
        do {
            let output = try await client.createGuestImport(
                body: .json(try Self.request(from: payload))
            )
            guard case .accepted(let response) = output else { throw Self.unexpected }
            return try Self.result(from: response.body.json)
        } catch {
            throw APIError.from(error)
        }
    }

    public func status(migrationID: UUID) async throws -> GuestImportResultRecord {
        let client = clientFactory.makeClient()
        do {
            let output = try await client.getGuestImport(
                path: .init(migrationId: migrationID.uuidString)
            )
            guard case .ok(let response) = output else { throw Self.unexpected }
            return try Self.result(from: response.body.json)
        } catch {
            throw APIError.from(error)
        }
    }

    // MARK: - Wire mapping

    /// The JSON-schema half of the contract types its enums as free-form
    /// values, so the strings the store holds pass through containers rather
    /// than generated cases. They are the contract's own raw values already.
    private static func request(
        from payload: GuestImportPayload
    ) throws -> Components.Schemas.guest_hyphen_import_period_v1_period_schema {
        try .init(
            payloadVersion: OpenAPIValueContainer(unvalidatedValue: 1),
            migrationId: payload.migrationID.uuidString.lowercased(),
            sourceInstallId: payload.sourceInstallID,
            sessions: payload.sessions.map { session in
                try .init(
                    id: session.id.uuidString.lowercased(),
                    deckId: session.deckID.uuidString.lowercased(),
                    mode: OpenAPIValueContainer(unvalidatedValue: session.mode),
                    requestedUniqueCount: OpenAPIValueContainer(
                        unvalidatedValue: session.requestedUniqueCount
                    ),
                    contentVersion: session.contentVersion,
                    startedAt: session.startedAt,
                    completedAt: session.completedAt
                )
            },
            reviews: payload.reviews.map(Self.review(from:))
        )
    }

    private static func review(
        from record: ReviewEventRecord
    ) throws -> Components.Schemas.review {
        if record.answerMode == "MULTIPLE_CHOICE", let optionID = record.selectedOptionID {
            return try .multipleChoiceReview(
                .init(
                    id: record.id.uuidString.lowercased(),
                    sessionId: record.sessionID.uuidString.lowercased(),
                    learningCardId: record.learningCardID.uuidString.lowercased(),
                    answerMode: OpenAPIValueContainer(unvalidatedValue: record.answerMode),
                    // No rating on the wire: an objective answer's rating is
                    // derived by whoever grades it, and the import must not
                    // smuggle in a judgement the server did not make.
                    selectedOptionId: optionID.uuidString.lowercased(),
                    clientOccurredAt: record.clientOccurredAt,
                    clientSequence: Int(record.clientSequence),
                    responseTimeMs: record.responseTimeMilliseconds
                )
            )
        }
        return try .selfRatedReview(
            .init(
                id: record.id.uuidString.lowercased(),
                sessionId: record.sessionID.uuidString.lowercased(),
                learningCardId: record.learningCardID.uuidString.lowercased(),
                answerMode: OpenAPIValueContainer(unvalidatedValue: record.answerMode),
                rating: OpenAPIValueContainer(unvalidatedValue: record.rating),
                clientOccurredAt: record.clientOccurredAt,
                clientSequence: Int(record.clientSequence),
                responseTimeMs: record.responseTimeMilliseconds
            )
        )
    }

    private static func result(
        from payload: Components.Schemas.GuestImportResult
    ) throws -> GuestImportResultRecord {
        guard let migrationID = UUID(uuidString: payload.migrationId),
            let status = GuestImportStatus(rawValue: payload.status.rawValue)
        else {
            throw APIError.decoding("The import result names a migration this client cannot read")
        }
        return GuestImportResultRecord(
            migrationID: migrationID,
            status: status,
            acceptedEventCount: payload.acceptedEventCount,
            duplicateEventCount: payload.duplicateEventCount,
            rejectedEventCount: payload.rejectedEventCount,
            completedAt: payload.completedAt
        )
    }

    private static var unexpected: APIError {
        APIError.status(
            APIErrorDetails(
                statusCode: 0,
                code: "UNKNOWN",
                message: "Unmapped guest import response",
                requestID: nil
            )
        )
    }
}
