import Foundation

import CountryFlagsDomain

/// Reads the account's change stream off the wire.
///
/// `GET /v1/me/changes` pages through every canonical card state the account
/// has ever produced, on any device. The cursor is opaque and account-scoped;
/// asked without one, the stream answers from the beginning — which is how a
/// fresh device inherits a learner's history.
public struct UserChangesService: UserChangesDownloading {
    private let clientFactory: APIClientFactory

    public init(clientFactory: APIClientFactory) {
        self.clientFactory = clientFactory
    }

    public func changes(after cursor: String?, limit: Int) async throws -> UserChangesPage {
        let client = clientFactory.makeClient()
        do {
            let output = try await client.getUserChanges(
                .init(query: .init(after: cursor, limit: limit))
            )
            guard case .ok(let response) = output else {
                throw APIError.status(
                    APIErrorDetails(
                        statusCode: 0,
                        code: "UNKNOWN",
                        message: "Unmapped user changes response",
                        requestID: nil
                    )
                )
            }
            let payload = try response.body.json
            return UserChangesPage(
                changes: payload.items.compactMap(Self.change),
                nextCursor: payload.nextCursor,
                hasMore: payload.hasMore
            )
        } catch {
            throw APIError.from(error)
        }
    }

    private static func change(
        from item: Components.Schemas.UserChange
    ) -> CardStateChange? {
        guard let cardID = UUID(uuidString: item.resourceId) else { return nil }
        switch item.operation {
        case .UPSERT:
            // An upsert without a readable state carries nothing to apply.
            guard let state = item.payload.flatMap(ReviewUploader.cardState) else {
                return nil
            }
            return CardStateChange(operation: .upsert, cardID: cardID, state: state)
        case .TOMBSTONE:
            return CardStateChange(operation: .tombstone, cardID: cardID, state: nil)
        }
    }
}
