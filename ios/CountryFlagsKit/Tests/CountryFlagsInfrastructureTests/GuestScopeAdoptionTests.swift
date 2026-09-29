import Security
import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// A guest moving to a new iPhone (#446).
///
/// The store travels in the backup. Builds before this change kept the
/// installation identifier `ThisDeviceOnly`, so the keychain arrived empty and
/// the new phone started as a new guest, with the old guest's progress in the
/// store under a scope nobody could name. These tests cover what the provider
/// does when the keychain is empty and the store is not.
final class GuestScopeAdoptionTests: XCTestCase {
    private let restoredGuest = AccountScope.guest(
        installationID: UUID(uuidString: "81000000-0000-4000-8000-0000000000a1")!
    )
    private let secondGuest = AccountScope.guest(
        installationID: UUID(uuidString: "81000000-0000-4000-8000-0000000000a2")!
    )
    private let minted = UUID(uuidString: "81000000-0000-4000-8000-0000000000ff")!

    /// The restored phone: the store holds one guest's session, answer and
    /// card state, and the keychain is empty. That guest is adopted, written
    /// back to the keychain, and their progress reads under it.
    func testARestoredStoreWithOneGuestIsAdoptedAndItsProgressIsShown() async throws {
        let temporary = TemporaryStore()
        defer { temporary.remove() }
        try await recordWork(in: try temporary.open(), for: restoredGuest)

        // The new phone: the same file, an empty keychain.
        let restored = try temporary.open()
        let tokens = InMemoryTokenStore()
        let logger = RecordingLogger()
        let provider = GuestScopeProvider(
            tokens: tokens,
            identifiers: FixedIdentifiers(value: minted),
            logger: logger,
            guestScopes: restored.makeGuestScopeDiscovery()
        )

        let scope = await provider.currentScope()

        XCTAssertEqual(scope, restoredGuest)
        let stored = try await tokens.value(for: .installationID)
        XCTAssertEqual(
            stored.flatMap(UUID.init(uuidString:)).map { AccountScope.guest(installationID: $0) },
            restoredGuest,
            "the adopted guest is written back, so the next launch finds it directly"
        )
        let learning = restored.makeLearningRepository()
        let reviews = try await learning.reviews(for: scope)
        XCTAssertEqual(reviews.count, 1)
        let states = try await learning.cardStates(for: scope)
        XCTAssertEqual(states.map(\.learningCardID), [PersistenceFixtures.cardID])
        XCTAssertEqual(logger.recorded.map(\.level), [.notice])
    }

    /// Two guests in one store: nothing says which is this person. Neither is
    /// adopted, nothing is merged, and both keep their records.
    func testTwoGuestsAreNeitherAdoptedNorMerged() async throws {
        let store = try LocalStore(location: .inMemory)
        try await recordWork(in: store, for: restoredGuest)
        try await recordWork(in: store, for: secondGuest)
        let logger = RecordingLogger()
        let provider = GuestScopeProvider(
            tokens: InMemoryTokenStore(),
            identifiers: FixedIdentifiers(value: minted),
            logger: logger,
            guestScopes: store.makeGuestScopeDiscovery()
        )

        let scope = await provider.currentScope()

        XCTAssertEqual(scope, .guest(installationID: minted))
        let learning = store.makeLearningRepository()
        let current = try await learning.reviews(for: scope)
        XCTAssertTrue(current.isEmpty, "the new guest starts empty rather than with a merge")
        for guest in [restoredGuest, secondGuest] {
            let reviews = try await learning.reviews(for: guest)
            XCTAssertEqual(reviews.count, 1, "\(guest.key) keeps its own work")
        }
        XCTAssertEqual(logger.recorded.map(\.level), [.notice])
        XCTAssertEqual(logger.recorded.first?.metadata["count"], .count(2))
    }

    /// The keychain's answer is final. A store holding some other guest's work
    /// does not replace the identifier this installation already has.
    func testAnIdentifierInTheKeychainWinsOverTheStore() async throws {
        let store = try LocalStore(location: .inMemory)
        try await recordWork(in: store, for: restoredGuest)
        let kept = UUID(uuidString: "81000000-0000-4000-8000-0000000000b1")!
        let tokens = InMemoryTokenStore(values: [.installationID: kept.uuidString])
        let provider = GuestScopeProvider(
            tokens: tokens,
            identifiers: FixedIdentifiers(value: minted),
            guestScopes: store.makeGuestScopeDiscovery()
        )

        let scope = await provider.currentScope()

        XCTAssertEqual(scope, .guest(installationID: kept))
    }

    /// A first launch: nothing in the keychain, nothing in the store.
    func testAnEmptyStoreMintsANewGuest() async throws {
        let store = try LocalStore(location: .inMemory)
        let tokens = InMemoryTokenStore()
        let provider = GuestScopeProvider(
            tokens: tokens,
            identifiers: FixedIdentifiers(value: minted),
            guestScopes: store.makeGuestScopeDiscovery()
        )

        let scope = await provider.currentScope()

        XCTAssertEqual(scope, .guest(installationID: minted))
        let stored = try await tokens.value(for: .installationID)
        XCTAssertEqual(stored, minted.uuidString)
    }

    /// Only a guest is adopted. A signed-in account's records came across in
    /// the backup too, but they belong to a session that has to be signed
    /// into again, not to the guest.
    func testAnAccountsRecordsAreNotAGuestToAdopt() async throws {
        let store = try LocalStore(location: .inMemory)
        try await recordWork(in: store, for: PersistenceFixtures.firstUserScope)
        let provider = GuestScopeProvider(
            tokens: InMemoryTokenStore(),
            identifiers: FixedIdentifiers(value: minted),
            guestScopes: store.makeGuestScopeDiscovery()
        )

        let scope = await provider.currentScope()

        XCTAssertEqual(scope, .guest(installationID: minted))
    }

    /// Everything that asks at launch asks at once, and asking the store adds
    /// a suspension in which another caller gets in. The first resolution is
    /// shared, so two callers cannot each mint a guest of their own. Every
    /// identifier minted here is different, so only one resolution can
    /// explain a single answer.
    func testCallersArrivingTogetherSettleOnOneGuest() async throws {
        let store = try LocalStore(location: .inMemory)
        let provider = GuestScopeProvider(
            tokens: InMemoryTokenStore(),
            identifiers: SequentialIdentifierProvider(),
            guestScopes: store.makeGuestScopeDiscovery()
        )

        let scopes = await withTaskGroup(of: AccountScope.self) { group in
            for _ in 0..<8 {
                group.addTask { await provider.currentScope() }
            }
            var collected: Set<AccountScope> = []
            for await scope in group { collected.insert(scope) }
            return collected
        }

        XCTAssertEqual(scopes.count, 1, "one launch, one guest: \(scopes)")
    }

    /// The identifier is not a secret and has to travel with the backup that
    /// carries the store. Everything else stays on this device.
    func testOnlyTheInstallationIdentifierLeavesTheDevice() {
        for kind in SecureTokenKind.allCases {
            let accessibility = KeychainTokenStore.accessibility(for: kind) as String
            if kind == .installationID {
                XCTAssertEqual(accessibility, kSecAttrAccessibleAfterFirstUnlock as String)
            } else {
                XCTAssertEqual(
                    accessibility,
                    kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String,
                    "\(kind) must not leave this device"
                )
            }
        }
    }

    // MARK: - Helpers

    /// A session, one answer in it, and the card state it projected.
    private func recordWork(in store: LocalStore, for scope: AccountScope) async throws {
        let learning = store.makeLearningRepository()
        try await learning.saveSession(PersistenceFixtures.session(), for: scope)
        try await learning.recordReview(
            PersistenceFixtures.review(),
            projectedState: PersistenceFixtures.cardState(),
            outbox: PersistenceFixtures.outbox(),
            for: scope
        )
    }
}

private struct FixedIdentifiers: IdentifierProviding {
    let value: UUID

    func next() -> UUID { value }
}
