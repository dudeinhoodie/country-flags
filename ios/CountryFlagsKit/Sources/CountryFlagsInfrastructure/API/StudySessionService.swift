import Foundation
import OpenAPIRuntime

import CountryFlagsDomain

/// The backend's half of session composition.
///
/// Two jobs, one wire: asking the server to compose a session (`SERVER`
/// selection), and handing it a session a device composed without network
/// (`CLIENT_OFFLINE` import) so the reviews that reference it can follow.
/// Both are idempotent on the session identifier, which the client mints.
public struct StudySessionService: StudySessionSelecting, StudySessionImporting {
    private let clientFactory: APIClientFactory
    private let content: any ContentRepository
    private let preferredLanguages: [String]
    private let dates: any DateProviding

    public init(
        clientFactory: APIClientFactory,
        content: any ContentRepository,
        preferredLanguages: [String] = Locale.preferredLanguages,
        dates: any DateProviding = SystemDateProvider()
    ) {
        self.clientFactory = clientFactory
        self.content = content
        self.preferredLanguages = preferredLanguages
        self.dates = dates
    }

    // MARK: - StudySessionSelecting

    public func serverSession(
        id: UUID,
        deckID: UUID,
        size: StudySessionSize,
        mode: StudyAnswerMode,
        composition: StudySessionComposition
    ) async throws -> StudySessionRecord {
        let client = clientFactory.makeClient()
        do {
            guard
                let count = Components.Schemas.CreateServerStudySessionRequest
                    .requestedUniqueCountPayload(rawValue: size.rawValue)
            else {
                throw APIError.decoding("The session size is not one the contract offers")
            }
            let request = Components.Schemas.CreateServerStudySessionRequest(
                id: id.uuidString.lowercased(),
                deckId: deckID.uuidString.lowercased(),
                requestedUniqueCount: count,
                mode: mode == .multipleChoice ? .MULTIPLE_CHOICE : .SELF_RATED,
                locale: await requestLocale(),
                selectionOrigin: .SERVER,
                composition: composition == .dueOnly ? .DUE_ONLY : .STANDARD
            )
            let output = try await client.createStudySession(
                body: .json(.SERVER(request))
            )
            switch output {
            case .created(let response):
                return try Self.record(from: response.body.json)
            case .ok(let response):
                // The same identifier asked twice is the same session, and the
                // stored snapshot is the answer.
                return try Self.record(from: response.body.json)
            default:
                throw Self.unexpected
            }
        } catch {
            throw APIError.from(error)
        }
    }

    public func completeSession(id: UUID) async {
        let client = clientFactory.makeClient()
        // Best effort by design: the reviews already carry the learning, and
        // a completion that misses is repeated by nobody. The backend closes
        // stale sessions on its own schedule.
        _ = try? await client.completeStudySession(
            .init(
                path: .init(sessionId: id.uuidString.lowercased()),
                body: .json(.init(completedAt: dates.now()))
            )
        )
    }

    // MARK: - StudySessionImporting

    public func importOfflineSession(_ session: StudySessionRecord) async throws {
        let client = clientFactory.makeClient()
        do {
            var cards: [Components.Schemas.OfflineStudySessionCard] = []
            for card in session.cards {
                cards.append(try await offlineCard(from: card))
            }
            guard
                let count = Components.Schemas.CreateOfflineStudySessionRequest
                    .requestedUniqueCountPayload(rawValue: session.requestedUniqueCount)
            else {
                throw APIError.decoding("The stored session size is not importable")
            }
            let request = Components.Schemas.CreateOfflineStudySessionRequest(
                id: session.id.uuidString.lowercased(),
                deckId: session.deckID.uuidString.lowercased(),
                requestedUniqueCount: count,
                mode: .SELF_RATED,
                locale: await requestLocale(),
                selectionOrigin: .CLIENT_OFFLINE,
                startedAt: session.startedAt,
                contentVersion: session.contentVersion,
                cards: cards
            )
            let output = try await client.createStudySession(
                body: .json(.CLIENT_OFFLINE(request))
            )
            switch output {
            case .created, .ok:
                return
            default:
                throw Self.unexpected
            }
        } catch {
            throw APIError.from(error)
        }
    }

    /// Rebuilds the wire form of one offline card from the stores.
    ///
    /// The snapshot travels for identity agreement only — the server rebuilds
    /// the persisted one from the declared revision — but the wire shape wants
    /// the whole card, so the whole card is read back out of the release the
    /// device studied.
    private func offlineCard(
        from card: StudySessionCardRecord
    ) async throws -> Components.Schemas.OfflineStudySessionCard {
        guard let learningCard = try await content.card(id: card.learningCardID) else {
            throw APIError.status(
                APIErrorDetails(
                    statusCode: 0,
                    code: "SESSION_CARD_MISSING",
                    message: "A studied card is no longer in the content store",
                    requestID: nil
                )
            )
        }
        guard let asset = try await content.asset(id: card.promptAssetID) else {
            throw APIError.status(
                APIErrorDetails(
                    statusCode: 0,
                    code: "SESSION_ASSET_MISSING",
                    message: "A studied card's asset is no longer in the content store",
                    requestID: nil
                )
            )
        }

        return Components.Schemas.OfflineStudySessionCard(
            learningCardId: card.learningCardID.uuidString.lowercased(),
            learningCardRevision: card.revision,
            assetSha256: asset.sha256.lowercased(),
            // The seed exists so a multiple-choice layout can be replayed; a
            // self-rated card has nothing to replay, and the card's own
            // identifier is as stable a seed as any.
            randomSeed: card.id.uuidString.lowercased(),
            snapshot: Self.snapshot(of: learningCard, asset: asset)
        )
    }

    private static func snapshot(
        of card: LearningCardRecord,
        asset: AssetRecord
    ) -> Components.Schemas.LearningCard {
        .init(
            id: card.id.uuidString.lowercased(),
            templateCode: card.templateCode,
            templateSchemaVersion: card.templateSchemaVersion,
            semanticVersion: card.semanticVersion,
            revision: card.revision,
            answerMode: card.answerMode == "MULTIPLE_CHOICE" ? .MULTIPLE_CHOICE : .SELF_RATED,
            prompt: .init(
                asset: .init(
                    id: asset.id.uuidString.lowercased(),
                    _type: asset.type,
                    // The one encoding this device actually has. The snapshot
                    // describes what was studied, and what was studied is the
                    // file that was drawn — the device stores no other.
                    representations: [
                        .init(
                            url: asset.url.absoluteString,
                            mimeType: Components.Schemas.AssetRepresentation
                                .mimeTypePayload(rawValue: asset.mimeType)
                                ?? .image_sol_svg_plus_xml,
                            sha256: asset.sha256.lowercased()
                        )
                    ],
                    // Not stored on the device: the licence belongs to the
                    // asset pipeline, and the snapshot is read for identity
                    // alone. An honest placeholder beats an invented licence.
                    licenseName: "UNKNOWN"
                )
            ),
            answer: .init(
                entityId: card.subjectEntityID.uuidString.lowercased(),
                displayName: card.displayName,
                aliases: card.aliases
            ),
            contentVersion: card.contentVersion
        )
    }

    // MARK: - Response mapping

    private static func record(
        from payload: Components.Schemas.StudySession
    ) throws -> StudySessionRecord {
        guard let id = UUID(uuidString: payload.id), let deckID = UUID(uuidString: payload.deckId)
        else {
            throw APIError.decoding("The session names identifiers this client cannot read")
        }
        var cards: [StudySessionCardRecord] = []
        for card in payload.cards {
            guard
                let cardID = UUID(uuidString: card.id),
                let learningCardID = UUID(uuidString: card.learningCard.id),
                let promptAssetID = UUID(uuidString: card.learningCard.prompt.asset.id)
            else {
                throw APIError.decoding("A session card names identifiers this client cannot read")
            }
            cards.append(
                StudySessionCardRecord(
                    id: cardID,
                    learningCardID: learningCardID,
                    initialOrder: card.initialOrder,
                    selectionReason: card.selectionReason,
                    displayName: card.learningCard.answer.displayName,
                    promptAssetID: promptAssetID,
                    revision: card.learningCard.revision,
                    optionIDs: [],
                    optionNames: []
                )
            )
        }
        return StudySessionRecord(
            id: id,
            deckID: deckID,
            mode: payload.mode.rawValue,
            selectionOrigin: payload.selectionOrigin.rawValue,
            requestedUniqueCount: payload.requestedUniqueCount.rawValue,
            status: payload.status.rawValue,
            contentVersion: payload.contentVersion,
            startedAt: payload.startedAt,
            completedAt: nil,
            cards: cards
        )
    }

    /// The locale sessions are asked for: what the stored release resolves
    /// for this device, the device's own preference before any release.
    private func requestLocale() async -> String {
        guard let manifest = try? await content.currentManifest() else {
            return preferredLanguages.first ?? "en"
        }
        return ContentLocaleResolver(preferredLanguages: preferredLanguages)
            .resolve(supported: manifest.supportedLocales, default: manifest.defaultLocale)
            .locale
    }

    private static var unexpected: APIError {
        APIError.status(
            APIErrorDetails(
                statusCode: 0,
                code: "UNKNOWN",
                message: "Unmapped study session response",
                requestID: nil
            )
        )
    }
}

/// Answers with the device the backend registered for this session.
///
/// The identifier is learned once from the device list — the backend marks
/// the calling device as current — kept beside the session's own secrets,
/// and discarded with them. A guest has no device to be: the reviews a guest
/// makes wait in the outbox until there is an account to attribute them to.
public struct RegisteredDeviceProvider: DeviceIdentityProviding {
    private let clientFactory: APIClientFactory
    private let tokens: any SecureTokenStoring
    private let scopes: any AccountScopeResolving

    public init(
        clientFactory: APIClientFactory,
        tokens: any SecureTokenStoring,
        scopes: any AccountScopeResolving
    ) {
        self.clientFactory = clientFactory
        self.tokens = tokens
        self.scopes = scopes
    }

    public func registeredDeviceID() async -> UUID? {
        guard case .authenticated = await scopes.currentScope() else { return nil }
        if let stored = try? await tokens.value(for: .accountDeviceID),
            let id = UUID(uuidString: stored) {
            return id
        }

        let client = clientFactory.makeClient()
        guard
            let output = try? await client.listDevices(),
            case .ok(let response) = output,
            let payload = try? response.body.json,
            let current = payload.items.first(where: { $0.current }),
            let id = UUID(uuidString: current.id)
        else {
            return nil
        }
        try? await tokens.setValue(id.uuidString.lowercased(), for: .accountDeviceID)
        return id
    }
}
