import Foundation
import OpenAPIRuntime

import CountryFlagsDomain

/// Sends queued reviews to `POST /v1/reviews/batch` and maps what came back.
///
/// The queued payload is sent as it was encoded when the review was recorded,
/// so a later build cannot change what an earlier one promised to send. This
/// type therefore decodes the stored bytes rather than rebuilding an event from
/// current types.
/// Supplies the registered device a review is attributed to.
///
/// The contract requires a `deviceId` on every review event. Registration
/// belongs to the auth work package, so this is the seam: until a device is
/// registered there is nothing to attribute reviews to, and inventing an
/// identifier would attach a learner's work to a device that does not exist.
public protocol DeviceIdentityProviding: Sendable {
    func registeredDeviceID() async -> UUID?
}

public enum ReviewUploadFailure: Error, Equatable, Sendable {
    /// No registered device, so nothing can be attributed. Retrying without
    /// registering first cannot help.
    case deviceNotRegistered
}

public struct ReviewUploader: ReviewUploading {
    /// The stored shape of one queued review. It matches what the study
    /// runners write, and the fields the contract requires of a review event.
    struct StoredReview: Decodable {
        let reviewID: UUID
        let sessionID: UUID
        let learningCardID: UUID
        let rating: String
        let answerMode: String
        let clientOccurredAt: Date
        let clientSequence: Int64
        let baseStateVersion: Int?
        let selectedOptionID: UUID?
    }

    private let clientFactory: APIClientFactory
    private let devices: any DeviceIdentityProviding
    private let logger: any AppLogging

    public init(
        clientFactory: APIClientFactory,
        devices: any DeviceIdentityProviding,
        logger: any AppLogging = NoOpLogger()
    ) {
        self.clientFactory = clientFactory
        self.devices = devices
        self.logger = logger
    }

    public func upload(_ operations: [OutboxOperationRecord]) async throws -> ReviewBatchOutcome {
        guard let deviceID = await devices.registeredDeviceID() else {
            throw ReviewUploadFailure.deviceNotRegistered
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        var events: [Components.Schemas.ReviewEvent] = []
        for operation in operations {
            guard let stored = try? decoder.decode(StoredReview.self, from: operation.payload) else {
                // A payload this build cannot read is not something to guess
                // at. It is reported and left for the queue to park rather than
                // sent as something it might not be.
                logger.log(
                    .error,
                    .sync,
                    "A queued review could not be decoded and was not sent",
                    ["operationId": .safe(operation.id.uuidString)]
                )
                continue
            }
            if let event = Self.event(from: stored, deviceID: deviceID) {
                events.append(event)
            }
        }

        guard !events.isEmpty else {
            return ReviewBatchOutcome(acknowledgements: [], cursor: nil, serverTime: Date())
        }

        let client = clientFactory.makeClient()
        let output: Operations.createReviewBatch.Output
        do {
            output = try await client.createReviewBatch(
                body: .json(.init(payloadVersion: ._1, events: events))
            )
        } catch {
            throw APIError.from(error)
        }

        switch output {
        case .ok(let response):
            let payload = try response.body.json
            return ReviewBatchOutcome(
                acknowledgements: payload.results.compactMap(Self.acknowledgement),
                cursor: payload.nextSyncCursor,
                serverTime: payload.serverTime
            )
        case .conflict, .unprocessableContent, .default:
            // Unreachable in practice: the error mapping middleware turns every
            // status at or above 400 into an `APIError` before the generated
            // client parses it, so a batch refusal arrives through the catch
            // above. Handled rather than ignored so a contract change cannot
            // silently produce a success here.
            throw APIError.status(
                APIErrorDetails(
                    statusCode: 0,
                    code: "UNKNOWN",
                    message: "Unmapped error response",
                    requestID: nil
                )
            )
        }
    }

    private static func event(
        from stored: StoredReview,
        deviceID: UUID
    ) -> Components.Schemas.ReviewEvent? {
        switch stored.answerMode {
        case StudyAnswerMode.selfRated.rawValue:
            guard let rating = Components.Schemas.Rating(rawValue: stored.rating) else { return nil }
            return .SELF_RATED(
                .init(
                    id: stored.reviewID.uuidString,
                    sessionId: stored.sessionID.uuidString,
                    learningCardId: stored.learningCardID.uuidString,
                    deviceId: deviceID.uuidString,
                    answerMode: .SELF_RATED,
                    rating: rating,
                    clientOccurredAt: stored.clientOccurredAt,
                    clientSequence: Int(stored.clientSequence),
                    baseStateVersion: stored.baseStateVersion
                )
            )
        case StudyAnswerMode.multipleChoice.rawValue:
            guard let selected = stored.selectedOptionID else { return nil }
            return .MULTIPLE_CHOICE(
                .init(
                    id: stored.reviewID.uuidString,
                    sessionId: stored.sessionID.uuidString,
                    learningCardId: stored.learningCardID.uuidString,
                    deviceId: deviceID.uuidString,
                    answerMode: .MULTIPLE_CHOICE,
                    selectedOptionId: selected.uuidString,
                    clientOccurredAt: stored.clientOccurredAt,
                    clientSequence: Int(stored.clientSequence),
                    baseStateVersion: stored.baseStateVersion
                )
            )
        default:
            return nil
        }
    }

    private static func acknowledgement(
        from result: Components.Schemas.ReviewResult
    ) -> ReviewAcknowledgement? {
        guard let eventID = UUID(uuidString: result.eventId),
            let status = ReviewAcknowledgementStatus(rawValue: result.status.rawValue)
        else {
            return nil
        }
        return ReviewAcknowledgement(
            eventID: eventID,
            status: status,
            rejectionCode: result.rejectionCode,
            cardState: result.cardState.flatMap(Self.cardState)
        )
    }

    private static func cardState(from payload: Components.Schemas.CardState) -> CardStateRecord? {
        guard let cardID = UUID(uuidString: payload.learningCardId) else { return nil }
        return CardStateRecord(
            learningCardID: cardID,
            state: payload.state.rawValue,
            difficulty: payload.difficulty,
            stability: payload.stability,
            dueAt: payload.dueAt,
            repetitions: payload.repetitions,
            lapses: payload.lapses,
            schedulerVersion: payload.schedulerVersion,
            stateVersion: payload.stateVersion,
            updatedAt: payload.updatedAt,
            // Anything that came from the backend is canonical by definition.
            isLocalProjection: false
        )
    }
}
