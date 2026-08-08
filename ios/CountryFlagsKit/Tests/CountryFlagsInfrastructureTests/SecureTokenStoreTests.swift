import XCTest

import CountryFlagsDomain
@testable import CountryFlagsInfrastructure

/// One contract, run against both implementations.
///
/// The in-memory double is only trustworthy as a test seam if it behaves like
/// the keychain, so both are held to the same expectations.
class SecureTokenStoreContractTests: XCTestCase {
    /// Overridden by each concrete case; the base class is not run on its own.
    func makeStore() async throws -> (any SecureTokenStoring)? {
        nil
    }

    func testStoresReadsAndRemovesEachKind() async throws {
        guard let store = try await makeStore() else { return }

        for kind in SecureTokenKind.allCases {
            let absent = try await store.value(for: kind)
            XCTAssertNil(absent, "\(kind) leaked from a previous run")

            try await store.setValue("value-for-\(kind.rawValue)", for: kind)
            let stored = try await store.value(for: kind)
            XCTAssertEqual(stored, "value-for-\(kind.rawValue)")

            try await store.setValue("rotated-\(kind.rawValue)", for: kind)
            let rotated = try await store.value(for: kind)
            XCTAssertEqual(rotated, "rotated-\(kind.rawValue)")
        }

        // Signing out has to leave nothing behind for the next account.
        try await store.removeAll()
        for kind in SecureTokenKind.allCases {
            let cleared = try await store.value(for: kind)
            XCTAssertNil(cleared)
        }
    }

    func testSettingNilRemovesASingleValue() async throws {
        guard let store = try await makeStore() else { return }

        try await store.setValue("access", for: .accessToken)
        try await store.setValue("refresh", for: .refreshToken)
        try await store.setValue(nil, for: .accessToken)

        let access = try await store.value(for: .accessToken)
        let refresh = try await store.value(for: .refreshToken)
        XCTAssertNil(access)
        XCTAssertEqual(refresh, "refresh")

        try await store.removeAll()
    }
}

final class InMemoryTokenStoreTests: SecureTokenStoreContractTests {
    override func makeStore() async throws -> (any SecureTokenStoring)? {
        InMemoryTokenStore()
    }
}

final class KeychainTokenStoreTests: SecureTokenStoreContractTests {
    /// A service name per run keeps the shared keychain from leaking state
    /// between tests.
    ///
    /// The package test bundle runs without an application host, so it carries
    /// no keychain entitlement and the platform answers every request with
    /// `errSecMissingEntitlement`. The case is skipped there rather than
    /// deleted: wherever a host exists the real adapter is held to the same
    /// contract as the double.
    override func makeStore() async throws -> (any SecureTokenStoring)? {
        let store = KeychainTokenStore(service: "app.countryflags.tests.\(UUID().uuidString)")
        do {
            try await store.setValue("probe", for: .accessToken)
            try await store.removeAll()
        } catch SecureTokenStoreError.unavailable(let status)
            where status == errSecMissingEntitlement
        {
            throw XCTSkip(
                "The keychain needs an application host; the package test bundle has none."
            )
        }
        return store
    }
}

final class SecureTokenBoundaryTests: XCTestCase {
    /// Tokens belong in the keychain, never in the local store. The schema is
    /// the proof: no model has a field that could hold one.
    func testNoStoredModelCanHoldAToken() {
        let names = LocalSchemaV1.models.map { String(describing: $0).lowercased() }
        for name in names {
            XCTAssertFalse(name.contains("token"))
            XCTAssertFalse(name.contains("credential"))
            XCTAssertFalse(name.contains("secret"))
        }
    }
}
