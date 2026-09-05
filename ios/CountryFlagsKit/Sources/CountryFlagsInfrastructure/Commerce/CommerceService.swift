import Foundation
import OpenAPIRuntime

import CountryFlagsDomain

/// The three consumer commerce endpoints, and nothing else.
///
/// The generated DTOs stop here, as everywhere else in this module: what
/// leaves is a domain record or an `APIError`, so a contract change cannot
/// reach a screen by accident.
public struct CommerceService: CommerceBackend {
    private let clientFactory: APIClientFactory
    private let dates: any DateProviding

    public init(
        clientFactory: APIClientFactory,
        dates: any DateProviding = SystemDateProvider()
    ) {
        self.clientFactory = clientFactory
        self.dates = dates
    }

    // MARK: - What is for sale

    /// The catalogue with no price in it. The price comes from the store,
    /// which is the only place a localized one exists and the only place App
    /// Review approved one.
    public func offers(platform: StorePlatform) async throws -> [CommerceOfferRecord] {
        let client = clientFactory.makeClient()
        let output: Operations.listCommerceOffers.Output
        do {
            output = try await client.listCommerceOffers(
                query: .init(platform: platform.rawValue)
            )
        } catch {
            throw APIError.from(error)
        }
        switch output {
        case .ok(let response):
            let now = dates.now()
            return try response.body.json.items.map { Self.record($0, updatedAt: now) }
        default:
            throw Self.unmapped()
        }
    }

    // MARK: - What this account may open

    public func entitlements(entityTag: String?) async throws -> EntitlementFetch {
        let client = clientFactory.makeClient()
        let output: Operations.getMyEntitlements.Output
        do {
            output = try await client.getMyEntitlements(
                headers: .init(If_hyphen_None_hyphen_Match: entityTag)
            )
        } catch {
            throw APIError.from(error)
        }
        switch output {
        case .notModified:
            // The whole point of the entity tag: a foreground check costs a
            // status line and no body, so asking often is not a reason to ask
            // less often.
            return .unchanged
        case .ok(let response):
            let payload = try response.body.json
            return .snapshot(
                EntitlementSnapshotRecord(
                    entitlementKeys: Set(payload.entitlementKeys),
                    checkedAt: payload.checkedAt
                ),
                entityTag: response.headers.ETag
            )
        default:
            throw Self.unmapped()
        }
    }

    // MARK: - Telling the server what was bought

    /// - Parameter idempotencyKey: the same key for the same set of
    ///   transactions, so the retry that follows a timeout is the same request
    ///   rather than a second one.
    /// - Returns: the account's whole snapshot afterwards, which is what
    ///   replaces the local one. The client never derives a right from a
    ///   payload it sent.
    public func submitAppleTransactions(
        _ signedTransactions: [String],
        idempotencyKey: String
    ) async throws -> EntitlementSnapshotRecord {
        let client = clientFactory.makeClient()
        let output: Operations.submitAppleTransactions.Output
        do {
            output = try await client.submitAppleTransactions(
                headers: .init(Idempotency_hyphen_Key: idempotencyKey),
                body: .json(
                    .init(
                        transactions: signedTransactions.map {
                            .init(signedTransaction: $0)
                        }
                    )
                )
            )
        } catch {
            throw APIError.from(error)
        }
        switch output {
        case .ok(let response):
            let payload = try response.body.json
            return EntitlementSnapshotRecord(
                entitlementKeys: Set(payload.entitlementKeys),
                checkedAt: payload.checkedAt
            )
        default:
            // A refusal — the `409` for a transaction another live account
            // already holds, the `413`, the `422` — arrives through the catch
            // above, because the error mapping middleware turns every status
            // at or above 400 into an `APIError` before the generated client
            // parses it. This branch exists so a contract change cannot
            // silently produce a success here instead.
            throw Self.unmapped()
        }
    }

    // MARK: - Translation

    private static func record(
        _ offer: Components.Schemas.CommerceOffer,
        updatedAt: Date
    ) -> CommerceOfferRecord {
        CommerceOfferRecord(
            code: offer.code,
            kind: offer.kind,
            storeProduct: offer.storeProduct.map {
                StoreProductRecord(provider: $0.provider, productID: $0.productId)
            },
            grants: offer.grants,
            title: offer.title,
            offerDescription: offer.description,
            updatedAt: updatedAt
        )
    }

    /// Unreachable in practice: the error mapping middleware turns every status
    /// at or above 400 into an `APIError` before the generated client parses
    /// it. Built rather than skipped so a contract change cannot silently
    /// produce a success here.
    private static func unmapped() -> APIError {
        APIError.status(
            APIErrorDetails(
                statusCode: 0,
                code: "UNKNOWN",
                message: "Unmapped commerce response",
                requestID: nil
            )
        )
    }
}
