import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// The analytics queue, from the consent check that decides whether an event
/// exists at all to the batch that empties it. Every test here is about a
/// promise the privacy model makes rather than about plumbing.
final class AnalyticsPipelineTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let account = AccountScope.authenticated(
        userID: UUID(uuidString: "90000000-0000-4000-8000-000000000201")!
    )

    // MARK: - Consent

    /// Nobody has been asked yet, so nothing optional is collected. This is the
    /// state a fresh install is in.
    func testAnUnaskedDeviceCollectsNothingOptional() async throws {
        let store = try LocalStore(location: .inMemory)
        let coordinator = makeCoordinator(store: store, consent: unasked)

        await coordinator.track(.deckOpened(deckType: .system, at: now))

        let pending = try await store.makeTelemetryRepository().pendingAnalyticsEvents(for: account)
        XCTAssertTrue(pending.isEmpty)
    }

    /// Operational events are not a consent question: they are how a failing
    /// sync becomes visible, and they carry an outcome and a bucket.
    func testOperationalEventsAreCollectedWithoutConsent() async throws {
        let store = try LocalStore(location: .inMemory)
        let coordinator = makeCoordinator(store: store, consent: unasked)

        await coordinator.track(.syncCompleted(result: .success, duration: .underOneSecond, at: now))

        let pending = try await store.makeTelemetryRepository().pendingAnalyticsEvents(for: account)
        XCTAssertEqual(pending.map(\.name), ["sync.completed"])
        XCTAssertEqual(pending.first?.isOptional, false)
    }

    func testGrantingConsentStartsOptionalCollection() async throws {
        let store = try LocalStore(location: .inMemory)
        let coordinator = makeCoordinator(store: store, consent: unasked)

        await coordinator.adopt(consent: granted)
        await coordinator.track(.deckOpened(deckType: .system, at: now))

        let pending = try await store.makeTelemetryRepository().pendingAnalyticsEvents(for: account)
        XCTAssertEqual(pending.map(\.name), ["deck.opened"])
    }

    /// Withdrawing consent is retroactive: what was collected under the old
    /// answer goes, and the operational events stay because they were never
    /// the question.
    func testWithdrawingConsentDropsPendingOptionalEventsAndKeepsOperationalOnes() async throws {
        let store = try LocalStore(location: .inMemory)
        let coordinator = makeCoordinator(store: store, consent: granted)
        await coordinator.track(.deckOpened(deckType: .system, at: now))
        await coordinator.track(.syncCompleted(result: .success, duration: .underOneSecond, at: now))

        await coordinator.adopt(consent: denied)

        let pending = try await store.makeTelemetryRepository().pendingAnalyticsEvents(for: account)
        XCTAssertEqual(pending.map(\.name), ["sync.completed"])
    }

    func testCollectionStopsAfterConsentIsWithdrawn() async throws {
        let store = try LocalStore(location: .inMemory)
        let coordinator = makeCoordinator(store: store, consent: granted)

        await coordinator.adopt(consent: denied)
        await coordinator.track(.deckOpened(deckType: .system, at: now))

        let pending = try await store.makeTelemetryRepository().pendingAnalyticsEvents(for: account)
        XCTAssertTrue(pending.isEmpty)
    }

    // MARK: - Delivery

    /// The offline case: events queue while nothing can be sent, and the batch
    /// goes out whole once something can.
    func testEventsQueuedOfflineAreSentAsOneBatchLater() async throws {
        let store = try LocalStore(location: .inMemory)
        let sender = RecordingSender(behaviour: .offline)
        let coordinator = makeCoordinator(store: store, consent: granted, sender: sender)

        await coordinator.track(.deckOpened(deckType: .system, at: now))
        await coordinator.track(.studySessionStarted(mode: .selfRated, requestedCardCount: 10, at: now))
        await coordinator.flush()

        var pending = try await store.makeTelemetryRepository().pendingAnalyticsEvents(for: account)
        XCTAssertEqual(pending.count, 2, "an undelivered batch stays queued")

        await sender.setBehaviour(.acceptsEverything)
        await coordinator.flush()

        pending = try await store.makeTelemetryRepository().pendingAnalyticsEvents(for: account)
        XCTAssertTrue(pending.isEmpty)
        let batches = await sender.batches()
        XCTAssertEqual(batches.last?.count, 2)
    }

    /// A duplicate is a success: the work reached the server, which is what the
    /// queue existed for.
    func testDuplicatesClearTheirEvents() async throws {
        let store = try LocalStore(location: .inMemory)
        let sender = RecordingSender(behaviour: .duplicatesEverything)
        let coordinator = makeCoordinator(store: store, consent: granted, sender: sender)
        await coordinator.track(.deckOpened(deckType: .system, at: now))

        await coordinator.flush()

        let pending = try await store.makeTelemetryRepository().pendingAnalyticsEvents(for: account)
        XCTAssertTrue(pending.isEmpty)
    }

    /// The partial-rejection rule: a refusal clears its event too. Keeping it
    /// would mean sending it again, being refused again, and never stopping.
    func testAPartialRejectionDoesNotLoopForever() async throws {
        let store = try LocalStore(location: .inMemory)
        let sender = RecordingSender(behaviour: .rejectsEverySecond)
        let coordinator = makeCoordinator(store: store, consent: granted, sender: sender)
        await coordinator.track(.deckOpened(deckType: .system, at: now))
        await coordinator.track(
            .studySessionStarted(mode: .selfRated, requestedCardCount: 10, at: now)
        )

        await coordinator.flush()

        let pending = try await store.makeTelemetryRepository().pendingAnalyticsEvents(for: account)
        XCTAssertTrue(pending.isEmpty, "a rejected event is parked, not retried")
        let batches = await sender.batches()
        XCTAssertEqual(batches.count, 1, "one refusal must not trigger another attempt")
    }

    /// An event the answer did not mention was never decided, so it stays.
    func testAnUnansweredEventStaysQueued() async throws {
        let store = try LocalStore(location: .inMemory)
        let sender = RecordingSender(behaviour: .answersNothing)
        let coordinator = makeCoordinator(store: store, consent: granted, sender: sender)
        await coordinator.track(.deckOpened(deckType: .system, at: now))

        await coordinator.flush()

        let pending = try await store.makeTelemetryRepository().pendingAnalyticsEvents(for: account)
        XCTAssertEqual(pending.count, 1)
    }

    /// The NoOp case: without a sender nothing is delivered, and nothing about
    /// the local policy changes — events are still collected and still filtered
    /// by consent.
    func testWithoutASenderEventsAreStillCollectedAndStillFiltered() async throws {
        let store = try LocalStore(location: .inMemory)
        let coordinator = makeCoordinator(store: store, consent: granted, sender: nil)

        await coordinator.track(.deckOpened(deckType: .system, at: now))
        await coordinator.flush()
        await coordinator.adopt(consent: denied)
        await coordinator.track(.deckOpened(deckType: .system, at: now))

        let pending = try await store.makeTelemetryRepository().pendingAnalyticsEvents(for: account)
        XCTAssertTrue(pending.isEmpty, "the withdrawal cleared what the flush could not send")
    }

    // MARK: - The envelope

    /// What actually goes on the wire: the registry's property names and types,
    /// an identifier drawn before the event was queued, and no free text.
    func testTheEnvelopeCarriesTheRegistrysShape() async throws {
        let store = try LocalStore(location: .inMemory)
        let sender = RecordingSender(behaviour: .acceptsEverything)
        let coordinator = makeCoordinator(store: store, consent: granted, sender: sender)

        await coordinator.track(
            .studySessionStarted(mode: .multipleChoice, requestedCardCount: 20, at: now)
        )
        await coordinator.flush()

        let batches = await sender.batches()
        let envelope = try XCTUnwrap(batches.first?.first)
        XCTAssertEqual(envelope.eventName, "study.session_started")
        XCTAssertEqual(envelope.schemaVersion, 1)
        XCTAssertEqual(envelope.properties["mode"], .string("multiple_choice"))
        XCTAssertEqual(envelope.properties["requestedCardCount"], .integer(20))
        XCTAssertEqual(envelope.context.platform, "ios")
        XCTAssertGreaterThanOrEqual(envelope.anonymousId.count, 16)
        XCTAssertGreaterThanOrEqual(envelope.sessionId.count, 8)
    }

    /// An integer property has to arrive as a number: the backend checks each
    /// value against the registry's declared type, and `"20"` is refused.
    func testIntegerPropertiesAreEncodedAsNumbers() async throws {
        let store = try LocalStore(location: .inMemory)
        let sender = RecordingSender(behaviour: .acceptsEverything)
        let coordinator = makeCoordinator(store: store, consent: granted, sender: sender)
        await coordinator.track(
            .studySessionStarted(mode: .selfRated, requestedCardCount: 20, at: now)
        )
        await coordinator.flush()
        let batches = await sender.batches()
        let envelope = try XCTUnwrap(batches.first?.first)

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let json = String(decoding: try encoder.encode(envelope), as: UTF8.self)

        XCTAssertTrue(json.contains("\"requestedCardCount\":20"), json)
        XCTAssertFalse(json.contains("\"requestedCardCount\":\"20\""), json)
    }

    // MARK: - Identity

    /// Signing out ends the identified context: the next event belongs to
    /// nobody the backend has seen before.
    func testSigningOutRotatesTheAnonymousIdentifier() async throws {
        let store = try LocalStore(location: .inMemory)
        let sender = RecordingSender(behaviour: .acceptsEverything)
        let coordinator = makeCoordinator(store: store, consent: granted, sender: sender)

        await coordinator.track(.deckOpened(deckType: .system, at: now))
        await coordinator.flush()
        let beforeBatches = await sender.batches()
        let before = try XCTUnwrap(beforeBatches.last?.first?.anonymousId)

        await coordinator.setIdentity(nil)
        await coordinator.track(.deckOpened(deckType: .system, at: now))
        await coordinator.flush()
        let afterBatches = await sender.batches()
        let after = try XCTUnwrap(afterBatches.last?.first?.anonymousId)

        XCTAssertNotEqual(before, after)
    }

    /// Signing in does not: cutting the funnel in half at the moment somebody
    /// signs in would make the one transition anybody cares about unreadable.
    func testSigningInKeepsTheAnonymousIdentifier() async throws {
        let store = try LocalStore(location: .inMemory)
        let sender = RecordingSender(behaviour: .acceptsEverything)
        let coordinator = makeCoordinator(store: store, consent: granted, sender: sender)

        await coordinator.track(.deckOpened(deckType: .system, at: now))
        await coordinator.flush()
        let beforeBatches = await sender.batches()
        let before = try XCTUnwrap(beforeBatches.last?.first?.anonymousId)

        await coordinator.setIdentity(
            AnalyticsIdentity(targetingKey: "opaque-key", isAuthenticated: true)
        )
        await coordinator.track(.deckOpened(deckType: .system, at: now))
        await coordinator.flush()
        let afterBatches = await sender.batches()
        let after = try XCTUnwrap(afterBatches.last?.first?.anonymousId)

        XCTAssertEqual(before, after)
    }

    // MARK: - Harness

    private var unasked: TelemetryConsent {
        .unasked(policyVersion: "2026-07-27", now: now)
    }

    private var granted: TelemetryConsent {
        TelemetryConsent(
            productAnalytics: .granted,
            diagnostics: .granted,
            policyVersion: "2026-07-27",
            version: 1,
            updatedAt: now
        )
    }

    private var denied: TelemetryConsent {
        TelemetryConsent(
            productAnalytics: .denied,
            diagnostics: .denied,
            policyVersion: "2026-07-27",
            version: 2,
            updatedAt: now
        )
    }

    private func makeCoordinator(
        store: LocalStore,
        consent: TelemetryConsent,
        sender: RecordingSender? = nil
    ) -> AnalyticsCoordinator {
        AnalyticsCoordinator(
            repository: store.makeTelemetryRepository(),
            scopes: FixedScopes(scope: account),
            contexts: TelemetryContextProvider(
                identityStore: InMemoryIdentityStore(),
                identifiers: SequentialIdentifierProvider(),
                appVersion: "1.0.0",
                build: "100",
                locale: "en"
            ),
            sender: sender,
            consent: consent,
            identifiers: SequentialIdentifierProvider(),
            dates: FixedDateProvider(instant: now)
        )
    }
}

// MARK: - Doubles

private struct FixedScopes: AccountScopeResolving {
    let scope: AccountScope

    func currentScope() async -> AccountScope { scope }
}

private final class InMemoryIdentityStore: TelemetryIdentityStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: String?

    func anonymousID() -> String? { lock.withLock { stored } }
    func store(anonymousID: String) { lock.withLock { stored = anonymousID } }
    func clearAnonymousID() { lock.withLock { stored = nil } }
}

private actor RecordingSender: AnalyticsBatchSending {
    enum Behaviour: Sendable {
        case acceptsEverything
        case duplicatesEverything
        case rejectsEverySecond
        case answersNothing
        case offline
    }

    private var behaviour: Behaviour
    private var sent: [[AnalyticsEnvelope]] = []

    init(behaviour: Behaviour) {
        self.behaviour = behaviour
    }

    func setBehaviour(_ value: Behaviour) { behaviour = value }
    func batches() -> [[AnalyticsEnvelope]] { sent }

    func send(_ events: [AnalyticsEnvelope]) async throws -> AnalyticsBatchOutcome {
        if case .offline = behaviour {
            throw PresentableError(kind: .offline)
        }
        sent.append(events)
        let results = events.enumerated().map { index, envelope in
            let status: AnalyticsIngestionStatus =
                switch behaviour {
                case .acceptsEverything, .offline: .accepted
                case .duplicatesEverything: .duplicate
                case .rejectsEverySecond: index.isMultiple(of: 2) ? .accepted : .rejected
                case .answersNothing: .accepted
                }
            return AnalyticsIngestionResult(
                eventID: envelope.eventId,
                status: status,
                rejectionCode: status == .rejected ? "UNREGISTERED_EVENT" : nil
            )
        }
        if case .answersNothing = behaviour {
            return AnalyticsBatchOutcome(results: [], serverTime: Date())
        }
        return AnalyticsBatchOutcome(results: results, serverTime: Date())
    }
}
