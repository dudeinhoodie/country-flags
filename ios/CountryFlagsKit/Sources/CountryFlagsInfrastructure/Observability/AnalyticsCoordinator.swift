import Foundation

import CountryFlagsDomain

/// The product's analytics, as this app actually collects them.
///
/// Everything the privacy model promises happens here, in this order: consent
/// is checked before an event is built, the event is queued on the device with
/// the identifier it will keep forever, and the queue is emptied in batches
/// whenever something asks it to. Nothing on this path blocks a card, a session
/// or a sync: every failure ends in "the event stays queued" or "the event is
/// dropped", never in an error a learner sees.
///
/// The consent check is deliberately at enqueue time rather than at send time.
/// An event that may not be collected must not exist on the device at all —
/// storing it and filtering later would mean holding exactly the data somebody
/// declined to give.
public actor AnalyticsCoordinator: AnalyticsTracking, TelemetryConsentApplying {
    private let repository: any TelemetryRepository
    private let scopes: any AccountScopeResolving
    private let sender: (any AnalyticsBatchSending)?
    private let contexts: TelemetryContextProvider
    private let identifiers: any IdentifierProviding
    private let dates: any DateProviding
    private let policy: AnalyticsQueuePolicy
    private let logger: any AppLogging

    /// The consent the device is acting under. Held here so a decision cannot
    /// change halfway through building a batch; refreshed from the store when
    /// the privacy screen writes one, and on every scope change.
    private var consent: TelemetryConsent
    private var isFlushing = false

    public init(
        repository: any TelemetryRepository,
        scopes: any AccountScopeResolving,
        contexts: TelemetryContextProvider,
        sender: (any AnalyticsBatchSending)? = nil,
        consent: TelemetryConsent,
        identifiers: any IdentifierProviding = SystemIdentifierProvider(),
        dates: any DateProviding = SystemDateProvider(),
        policy: AnalyticsQueuePolicy = .standard,
        logger: any AppLogging = NoOpLogger()
    ) {
        self.repository = repository
        self.scopes = scopes
        self.contexts = contexts
        self.sender = sender
        self.consent = consent
        self.identifiers = identifiers
        self.dates = dates
        self.policy = policy
        self.logger = logger
    }

    // MARK: - Consent

    /// Adopts a decision, and applies it to what is already queued.
    ///
    /// Withdrawing consent is not only about the future: events collected under
    /// the old answer are removed before anything else happens, which is what
    /// makes the withdrawal true rather than prospective.
    public func adopt(consent updated: TelemetryConsent) async {
        let wasAllowed = consent.allows(.productAnalytics)
        consent = updated
        guard wasAllowed, !updated.allows(.productAnalytics) else { return }
        let scope = await scopes.currentScope()
        let removed = (try? await repository.removeOptionalAnalyticsEvents(for: scope)) ?? 0
        if removed > 0 {
            logger.log(
                .notice,
                .analytics,
                "Optional analytics events were discarded after consent was withdrawn",
                ["count": .count(removed)]
            )
        }
    }

    public func currentConsent() -> TelemetryConsent { consent }

    // MARK: - AnalyticsTracking

    public func track(_ event: AnalyticsEvent) async {
        guard consent.allows(event) else { return }
        let scope = await scopes.currentScope()
        let envelope = AnalyticsEnvelope(
            event: event,
            // Drawn before the event is queued, so a retry is a duplicate the
            // backend drops rather than a second event.
            id: identifiers.next(),
            context: await contexts.context()
        )
        guard let payload = try? Self.encoder.encode(envelope) else {
            // An event that cannot be encoded is a programming error, not a
            // reason to fail whatever the learner was doing.
            logger.log(.error, .analytics, "An analytics event could not be encoded")
            return
        }
        let record = AnalyticsEventRecord(
            id: envelope.eventId,
            name: event.name.rawValue,
            schemaVersion: event.schemaVersion,
            payload: payload,
            isOptional: event.isOptional,
            occurredAt: event.occurredAt
        )
        try? await repository.enqueueAnalyticsEvent(record, for: scope)
        await prune(scope: scope)
    }

    /// Signing in does not restart the funnel — the anonymous identifier is
    /// deliberately kept across it — but signing out does: `nil` ends the
    /// identified context, and the events that follow belong to nobody the
    /// backend has seen before.
    public func setIdentity(_ identity: AnalyticsIdentity?) async {
        guard identity == nil else { return }
        await contexts.rotateIdentity()
    }

    /// Empties the queue, oldest first, in batches.
    ///
    /// Reentrancy is guarded rather than queued: two flushes racing would send
    /// the same events twice, and while the backend would call the second one a
    /// duplicate, doing it on purpose is worse than not doing it.
    public func flush() async {
        guard let sender, !isFlushing else { return }
        isFlushing = true
        defer { isFlushing = false }

        let scope = await scopes.currentScope()
        await prune(scope: scope)

        while true {
            let pending = ((try? await repository.pendingAnalyticsEvents(for: scope)) ?? [])
                .sorted { $0.occurredAt < $1.occurredAt }
            guard !pending.isEmpty else { return }

            let batch = Array(pending.prefix(policy.batchSize))
            let envelopes = batch.compactMap { record in
                try? Self.decoder.decode(AnalyticsEnvelope.self, from: record.payload)
            }
            guard !envelopes.isEmpty else {
                // Nothing in this batch can be read — a downgrade, or a record
                // written by a build that is gone. They are dropped rather than
                // retried forever.
                try? await repository.removeAnalyticsEvents(ids: batch.map(\.id), for: scope)
                continue
            }

            let outcome: AnalyticsBatchOutcome
            do {
                outcome = try await sender.send(envelopes)
            } catch {
                // The batch stays queued exactly as it is. Analytics never
                // reports its own failure to anybody.
                logger.log(
                    .debug,
                    .analytics,
                    "The analytics batch could not be delivered and stays queued"
                )
                return
            }

            // Every answered status clears its event: accepted and duplicate
            // because the work reached the server, rejected because asking
            // again would be refused again — which is exactly how a partial
            // rejection turns into an infinite retry.
            let answered = Set(outcome.results.map(\.eventID))
            let rejected = outcome.results.filter { $0.status == .rejected }
            if !rejected.isEmpty {
                logger.log(
                    .error,
                    .analytics,
                    "The backend refused analytics events",
                    [
                        "count": .count(rejected.count),
                        "code": .safe(rejected.first?.rejectionCode ?? "UNKNOWN"),
                    ]
                )
            }
            try? await repository.removeAnalyticsEvents(ids: Array(answered), for: scope)

            // An event the answer did not mention was not decided; it stays
            // queued. Stopping here rather than looping keeps a backend that
            // answers nothing from spinning this forever.
            if answered.isEmpty { return }
            if batch.count < policy.batchSize { return }
        }
    }

    // MARK: - Housekeeping

    /// Applies the queue's limits: nothing older than the time to live, and no
    /// more than the ceiling — oldest first, because the newest events are the
    /// ones still worth explaining.
    private func prune(scope: AccountScope) async {
        let pending = ((try? await repository.pendingAnalyticsEvents(for: scope)) ?? [])
            .sorted { $0.occurredAt < $1.occurredAt }
        guard !pending.isEmpty else { return }

        let deadline = dates.now().addingTimeInterval(-policy.timeToLive)
        var doomed = pending.filter { $0.occurredAt < deadline }.map(\.id)

        let survivors = pending.filter { $0.occurredAt >= deadline }
        if survivors.count > policy.maximumStoredEvents {
            doomed += survivors.prefix(survivors.count - policy.maximumStoredEvents).map(\.id)
        }
        guard !doomed.isEmpty else { return }
        try? await repository.removeAnalyticsEvents(ids: doomed, for: scope)
        logger.log(
            .debug,
            .analytics,
            "Analytics events were dropped by the queue's own limits",
            ["count": .count(doomed.count)]
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
