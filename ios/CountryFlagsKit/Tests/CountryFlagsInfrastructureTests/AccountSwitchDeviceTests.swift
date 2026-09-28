import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure
import CountryFlagsMockBackend

/// A session that expired, then a sign-in to another account (#443).
///
/// The device the keychain remembered belonged to the first account, every
/// answer went up as that device, the backend refused each one as
/// `DEVICE_NOT_FOUND`, and the queue parked them for good. These drive the
/// session, the device provider and the uploader over one transport, because
/// the fault lived in how they share the keychain rather than in any one of
/// them.
final class AccountSwitchDeviceTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let accountA = "a1000000-0000-4000-8000-000000000443"
    private let accountB = "b1000000-0000-4000-8000-000000000443"
    private let deviceA = "da000000-0000-4000-8000-000000000443"
    private let deviceB = "db000000-0000-4000-8000-000000000443"
    private let avatar = URL(string: "https://example.test/a.png")!

    // MARK: - Adopting another account's session

    func testSigningIntoAnotherAccountResolvesItsDeviceBeforeTheNextUpload() async throws {
        let transport = MockClientTransport()
        let tokens = InMemoryTokenStore()
        let session = makeSession(transport: transport, tokens: tokens)
        let devices = RegisteredDeviceProvider(
            clientFactory: makeFactory(transport: transport),
            tokens: tokens,
            scopes: session
        )

        await signIn(session, as: accountA, transport: transport)
        await transport.enqueue(deviceList(current: deviceA), for: "listDevices")
        let first = await devices.registeredDeviceID()
        XCTAssertEqual(first, UUID(uuidString: deviceA))
        await expire(session, transport: transport)

        await signIn(session, as: accountB, transport: transport)
        await transport.enqueue(deviceList(current: deviceB), for: "listDevices")
        let second = await devices.registeredDeviceID()

        XCTAssertEqual(second, UUID(uuidString: deviceB), "B's answers go up as B's device")
        let lists = await transport.requests(for: "listDevices")
        XCTAssertEqual(lists.count, 2, "the device was asked again, not remembered")
    }

    /// The toolbar draws what the profile names, and A's picture is not B's.
    func testSigningIntoAnotherAccountDropsThePreviousPicture() async throws {
        let transport = MockClientTransport()
        let session = makeSession(transport: transport, tokens: InMemoryTokenStore())
        await signIn(session, as: accountA, transport: transport)
        await session.adoptProviderProfile(name: nil, avatarURL: avatar)
        await expire(session, transport: transport)

        await signIn(session, as: accountB, transport: transport)

        let profile = await session.currentProfile()
        XCTAssertNotNil(profile)
        XCTAssertNil(profile?.avatarURL)
    }

    /// The same person signing back in after an expiry keeps their picture:
    /// only an Apple sign-in, which shares none, would otherwise lose it.
    func testSigningBackIntoTheSameAccountKeepsItsPicture() async throws {
        let transport = MockClientTransport()
        let session = makeSession(transport: transport, tokens: InMemoryTokenStore())
        await signIn(session, as: accountA, transport: transport)
        await session.adoptProviderProfile(name: nil, avatarURL: avatar)
        await expire(session, transport: transport)

        await signIn(session, as: accountA, transport: transport)

        let profile = await session.currentProfile()
        XCTAssertEqual(profile?.avatarURL, avatar)
    }

    // MARK: - A device the backend does not know

    /// The backend's refusal of the device is no verdict on the answers: the
    /// device is resolved again and the same answers go under it.
    func testAnUnknownDeviceIsResolvedAgainAndTheAnswersResent() async throws {
        let transport = backend(current: deviceB)
        let tokens = InMemoryTokenStore(values: [.accountDeviceID: deviceA])
        let uploader = makeUploader(transport: transport, tokens: tokens)

        let outcome = try await uploader.upload([queuedReview()])

        XCTAssertEqual(outcome.acknowledgements.map(\.status), [.accepted])
        let batches = await transport.requests(for: "createReviewBatch")
        XCTAssertEqual(batches.map(deviceIDs(in:)), [[deviceA], [deviceB]])
        let stored = try await tokens.value(for: .accountDeviceID)
        XCTAssertEqual(stored, deviceB)
    }

    /// With nothing better to send them as, the answers are left out of the
    /// outcome, and the queue keeps anything it was not told about.
    func testAnUnknownDeviceWithNothingToResolveLeavesTheAnswersUndecided() async throws {
        let transport = backend(current: nil)
        let tokens = InMemoryTokenStore(values: [.accountDeviceID: deviceA])
        let uploader = makeUploader(transport: transport, tokens: tokens)

        let outcome = try await uploader.upload([queuedReview()])

        XCTAssertTrue(outcome.acknowledgements.isEmpty)
        let stored = try await tokens.value(for: .accountDeviceID)
        XCTAssertNil(stored, "the next run asks the backend again")
    }

    /// The queue's side of it: the answer is delivered in the same run, and
    /// nothing is parked as `DEVICE_NOT_FOUND`.
    func testTheQueueDeliversRatherThanParksAnAnswerForAnUnknownDevice() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        let scope = AccountScope.authenticated(userID: UUID(uuidString: accountB)!)
        try await outbox.enqueue(queuedReview(), for: scope)
        let transport = backend(current: deviceB)
        let coordinator = SyncCoordinator(
            outbox: outbox,
            learning: store.makeLearningRepository(),
            uploader: makeUploader(
                transport: transport,
                tokens: InMemoryTokenStore(values: [.accountDeviceID: deviceA])
            ),
            dates: FixedDateProvider(instant: now)
        )

        await coordinator.synchronize(scope: scope, trigger: .signedIn)

        let pending = try await outbox.pendingOperations(for: scope)
        XCTAssertTrue(pending.isEmpty)
        let parked = try await outbox.operations(failedWith: "DEVICE_NOT_FOUND", for: scope)
        XCTAssertTrue(parked.isEmpty)
    }

    /// And when no device can be resolved, the answer waits in the queue
    /// instead of being parked.
    func testTheQueueKeepsAnAnswerItCouldNotAttribute() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        let scope = AccountScope.authenticated(userID: UUID(uuidString: accountB)!)
        try await outbox.enqueue(queuedReview(), for: scope)
        let coordinator = SyncCoordinator(
            outbox: outbox,
            learning: store.makeLearningRepository(),
            uploader: makeUploader(
                transport: backend(current: nil),
                tokens: InMemoryTokenStore(values: [.accountDeviceID: deviceA])
            ),
            dates: FixedDateProvider(instant: now)
        )

        await coordinator.synchronize(scope: scope, trigger: .signedIn)

        let pending = try await outbox.pendingOperations(for: scope)
        XCTAssertEqual(pending.count, 1)
        let parked = try await outbox.operations(failedWith: "DEVICE_NOT_FOUND", for: scope)
        XCTAssertTrue(parked.isEmpty)
    }

    /// Builds before this fix parked such answers for good. The device is
    /// attached when a batch is sent, not stored with the answer, so the next
    /// run sends the same bytes again under the device it resolves.
    func testAnAnswerParkedForAnUnknownDeviceByAnEarlierBuildIsDelivered() async throws {
        let store = try LocalStore(location: .inMemory)
        let outbox = store.makeOutboxRepository()
        let scope = AccountScope.authenticated(userID: UUID(uuidString: accountB)!)
        let review = queuedReview()
        try await outbox.enqueue(review, for: scope)
        try await outbox.updateState(
            of: review.id,
            to: .permanentFailure,
            failureCode: "DEVICE_NOT_FOUND",
            for: scope
        )
        let transport = backend(current: deviceB)
        let coordinator = SyncCoordinator(
            outbox: outbox,
            learning: store.makeLearningRepository(),
            uploader: makeUploader(
                transport: transport,
                tokens: InMemoryTokenStore(values: [.accountDeviceID: deviceB])
            ),
            dates: FixedDateProvider(instant: now)
        )

        await coordinator.synchronize(scope: scope, trigger: .launch)

        let parked = try await outbox.operations(failedWith: "DEVICE_NOT_FOUND", for: scope)
        XCTAssertTrue(parked.isEmpty)
        let pending = try await outbox.pendingOperations(for: scope)
        XCTAssertTrue(pending.isEmpty)
        let batches = await transport.requests(for: "createReviewBatch")
        XCTAssertEqual(batches.map(deviceIDs(in:)), [[deviceB]])
    }

    // MARK: - Assembly

    private func makeFactory(transport: MockClientTransport) -> APIClientFactory {
        APIClientFactory(
            configuration: APITestClient.configuration,
            transport: transport,
            identifiers: SequentialIdentifierProvider(),
            logger: NoOpAPIRequestLogger(),
            retryPolicy: RetryPolicy(maximumAttempts: 1),
            scheduler: RecordingBackoffScheduler(),
            jitter: ZeroJitterProvider()
        )
    }

    private func makeSession(
        transport: MockClientTransport,
        tokens: any SecureTokenStoring
    ) -> SessionCoordinator {
        SessionCoordinator(
            service: AuthService(
                clientFactory: makeFactory(transport: transport),
                devices: InstallationDeviceRegistration(tokens: tokens, appVersion: "1.2.3")
            ),
            tokens: tokens,
            guestScopes: GuestScope(),
            logger: NoOpLogger()
        )
    }

    private func makeUploader(
        transport: MockClientTransport,
        tokens: any SecureTokenStoring
    ) -> ReviewUploader {
        ReviewUploader(
            clientFactory: makeFactory(transport: transport),
            devices: RegisteredDeviceProvider(
                clientFactory: makeFactory(transport: transport),
                tokens: tokens,
                scopes: SignedInScope(userID: UUID(uuidString: accountB)!)
            )
        )
    }

    private func signIn(
        _ session: SessionCoordinator,
        as userID: String,
        transport: MockClientTransport
    ) async {
        await transport.enqueue(
            MockAuth.session(now: now, userID: userID),
            for: "authenticateWithGoogle"
        )
        let outcome = await session.signIn(with: .google(idToken: String(repeating: "t", count: 40)))
        XCTAssertEqual(outcome, .succeeded(userID: UUID(uuidString: userID)!))
    }

    /// The backend refuses the refresh token, and the session is over without
    /// anybody signing out: the account identifier and whatever else the
    /// keychain held for it stay behind.
    private func expire(_ session: SessionCoordinator, transport: MockClientTransport) async {
        await transport.enqueue(
            .errorEnvelope(statusCode: 401, code: "REFRESH_TOKEN_INVALID"),
            for: "refreshSession"
        )
        _ = try? await session.refreshAccessToken()
        let state = await session.currentState()
        guard case .authenticationExpired = state else {
            return XCTFail("expected an expired session, got \(state)")
        }
    }

    /// Reviews answered as the device the backend holds for the account, and
    /// refused as `DEVICE_NOT_FOUND` for any other; the device list names
    /// `current` as this session's device, or none.
    private func backend(current: String?) -> MockClientTransport {
        let known = current
        let batch: MockClientTransport.Handler = { request in
            guard let body = request.body,
                let payload = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
                let events = payload["events"] as? [[String: Any]]
            else {
                return .errorEnvelope(statusCode: 422, code: "VALIDATION_FAILED")
            }
            let results: [[String: Any]] = events.compactMap { event in
                guard let id = event["id"] as? String else { return nil }
                let device = (event["deviceId"] as? String)?.lowercased()
                return device == known
                    ? ["eventId": id, "status": "ACCEPTED"]
                    : ["eventId": id, "status": "REJECTED", "rejectionCode": "DEVICE_NOT_FOUND"]
            }
            let document: [String: Any] = [
                "results": results,
                "achievements": [],
                "deckSummaries": [],
                "serverTime": "2027-01-15T08:00:00Z",
                "nextSyncCursor": "cursor-1",
            ]
            return .json((try? JSONSerialization.data(withJSONObject: document)) ?? Data())
        }
        return MockClientTransport(
            fallbacks: ["listDevices": deviceList(current: current)],
            handlers: ["createReviewBatch": batch]
        )
    }

    private func deviceList(current: String?) -> MockClientTransport.Response {
        guard let current else { return .json(#"{"items":[]}"#) }
        return .json(
            """
            {"items":[{"id":"\(current)","platform":"IOS","appVersion":"1.0.0",\
            "locale":"en","timezone":"UTC","lastSeenAt":"2027-01-15T08:00:00Z",\
            "current":true}]}
            """
        )
    }

    private func deviceIDs(in request: MockClientTransport.RecordedRequest) -> [String] {
        guard let body = request.body,
            let payload = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
            let events = payload["events"] as? [[String: Any]]
        else { return [] }
        return events.compactMap { ($0["deviceId"] as? String)?.lowercased() }
    }

    /// One answer as the study runner queues it.
    private func queuedReview() -> OutboxOperationRecord {
        let payload = """
            {"reviewID":"92000000-0000-4000-8000-000000000443",\
            "sessionID":"90000000-0000-4000-8000-000000000443",\
            "learningCardID":"93000000-0000-4000-8000-000000000443",\
            "rating":"GOOD","answerMode":"SELF_RATED",\
            "clientOccurredAt":"2027-01-15T08:00:00Z",\
            "clientSequence":1,"baseStateVersion":0,"selectedOptionID":null}
            """
        return OutboxOperationRecord(
            id: UUID(uuidString: "b0000000-0000-4000-8000-000000000443")!,
            kind: .reviewBatch,
            dependencyID: nil,
            payload: Data(payload.utf8),
            state: .pending,
            attemptCount: 0,
            lastFailureCode: nil,
            createdAt: now,
            updatedAt: now
        )
    }
}

private struct GuestScope: AccountScopeResolving {
    func currentScope() async -> AccountScope {
        .guest(installationID: UUID(uuidString: "10000000-0000-4000-8000-000000000443")!)
    }
}

private struct SignedInScope: AccountScopeResolving {
    let userID: UUID

    func currentScope() async -> AccountScope { .authenticated(userID: userID) }
}
