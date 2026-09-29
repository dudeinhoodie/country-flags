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
    /// Drops the remembered device, so the next `registeredDeviceID()` asks
    /// the backend again. Called when the backend says it does not know the
    /// device a review named.
    func forgetRegisteredDevice() async
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
        // What was sent, kept to send again under another device.
        var sent: [StoredReview] = []
        // The server answers in review IDs; the queue is keyed by operation
        // IDs. This map is the only bridge between the two, so an answer that
        // cannot be traced back to its operation is dropped rather than acted
        // on against the wrong key.
        var operationIDByReviewID: [UUID: UUID] = [:]
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
            if let event = Self.event(from: stored, deviceID: deviceID, logger: logger) {
                events.append(event)
                sent.append(stored)
                operationIDByReviewID[stored.reviewID] = operation.id
            }
        }

        guard !events.isEmpty else {
            return ReviewBatchOutcome(acknowledgements: [], cursor: nil, serverTime: Date())
        }

        let first = try await send(events, operationIDByReviewID: operationIDByReviewID)
        let unknownDevice = Set(
            first.acknowledgements
                .filter { $0.status == .rejected && $0.rejectionCode == Self.deviceNotFound }
                .map(\.eventID)
        )
        guard !unknownDevice.isEmpty else { return first }

        // The backend does not know the device these answers named: it was
        // removed, or it belongs to the account this device was signed into
        // before. Parking them was permanent (#443) for something that is no
        // verdict on the answers at all. The device is resolved again and the
        // same answers go once more under it.
        let kept = first.acknowledgements.filter { !unknownDevice.contains($0.eventID) }
        await devices.forgetRegisteredDevice()
        guard let resolved = await devices.registeredDeviceID(), resolved != deviceID else {
            // Nothing better to send them as. Left out of the outcome, they
            // stay queued for the next run rather than being parked.
            logger.log(
                .error,
                .sync,
                "The backend does not know this device and no other could be resolved",
                ["count": .count(unknownDevice.count)]
            )
            return ReviewBatchOutcome(
                acknowledgements: kept,
                cursor: first.cursor,
                serverTime: first.serverTime
            )
        }
        logger.log(
            .notice,
            .sync,
            "Resending answers under the device the backend resolved",
            ["count": .count(unknownDevice.count)]
        )
        let resent = sent
            .filter { unknownDevice.contains($0.reviewID) }
            .compactMap { Self.event(from: $0, deviceID: resolved, logger: logger) }
        let second: ReviewBatchOutcome
        do {
            second = try await send(resent, operationIDByReviewID: operationIDByReviewID)
        } catch {
            // The first answer still stands: what it accepted is stored, and
            // the resent answers stay queued for the next run.
            logger.log(
                .notice,
                .sync,
                "Answers resent under the resolved device did not reach the backend",
                ["count": .count(unknownDevice.count)]
            )
            return ReviewBatchOutcome(
                acknowledgements: kept,
                cursor: first.cursor,
                serverTime: first.serverTime
            )
        }
        // A second refusal of a device just resolved is not something another
        // attempt in this run can fix; those answers stay queued too.
        let settled = second.acknowledgements.filter {
            !($0.status == .rejected && $0.rejectionCode == Self.deviceNotFound)
        }
        if settled.count < second.acknowledgements.count {
            await devices.forgetRegisteredDevice()
        }
        return ReviewBatchOutcome(
            acknowledgements: kept + settled,
            cursor: second.cursor ?? first.cursor,
            serverTime: second.serverTime
        )
    }

    /// The backend's code for a review naming a device it does not hold for
    /// this account.
    static let deviceNotFound = "DEVICE_NOT_FOUND"

    private func send(
        _ events: [Components.Schemas.ReviewEvent],
        operationIDByReviewID: [UUID: UUID]
    ) async throws -> ReviewBatchOutcome {
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
                acknowledgements: payload.results.compactMap {
                    Self.acknowledgement(from: $0, operationIDByReviewID: operationIDByReviewID)
                },
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
        deviceID: UUID,
        logger: any AppLogging
    ) -> Components.Schemas.ReviewEvent? {
        switch stored.answerMode {
        case StudyAnswerMode.selfRated.rawValue:
            // `SubmittedRating`, not `Rating`: the backend accepts the two
            // answers a swipe produces (ADR-024). A row queued by a build with
            // the four-grade screen can still hold HARD or EASY, and there is
            // nothing honest to send for it — mapping it onto GOOD would
            // record an answer the learner did not give. It is reported and
            // left rather than dropped in silence.
            guard let rating = Components.Schemas.SubmittedRating(rawValue: stored.rating) else {
                logger.log(
                    .error,
                    .sync,
                    "A queued review holds a rating this release cannot send",
                    ["reviewId": .safe(stored.reviewID.uuidString)]
                )
                return nil
            }
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
        from result: Components.Schemas.ReviewResult,
        operationIDByReviewID: [UUID: UUID]
    ) -> ReviewAcknowledgement? {
        guard let eventID = UUID(uuidString: result.eventId),
            let operationID = operationIDByReviewID[eventID],
            let status = ReviewAcknowledgementStatus(rawValue: result.status.rawValue)
        else {
            return nil
        }
        return ReviewAcknowledgement(
            operationID: operationID,
            eventID: eventID,
            status: status,
            rejectionCode: result.rejectionCode,
            cardState: result.cardState.flatMap(Self.cardState)
        )
    }

    static func cardState(from payload: Components.Schemas.CardState) -> CardStateRecord? {
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
