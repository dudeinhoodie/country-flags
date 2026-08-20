import Foundation
import Observation

import CountryFlagsDomain

/// What the privacy section reads and drives.
///
/// A consent decision is applied in an order that matters: it is stored on the
/// device first, the collectors are told immediately — which is what drops
/// events queued under the old answer — and only then is it offered to the
/// backend. A device that told the server first and lost the network would be a
/// device still collecting under an answer somebody had already withdrawn.
///
/// The server owns the version, exactly as it does for the study settings: a
/// refusal means another device answered first, and the answer is to take what
/// the server has rather than to retry and overwrite it.
@MainActor
@Observable
public final class PrivacyStore {
    public private(set) var consent: TelemetryConsent
    public private(set) var isLoaded = false
    /// Set when a change was refused because another device had written. The
    /// screen already shows the server's answer by then; this explains why it
    /// is not what was just chosen.
    public private(set) var didReloadAfterConflict = false

    private let repository: any TelemetryRepository
    private let scopes: any AccountScopeResolving
    private let sync: (any PrivacySettingsSyncing)?
    private let collectors: [any TelemetryConsentApplying]
    private let dates: any DateProviding

    /// The policy the current copy was written against. A published policy
    /// change is what makes a previous answer stale; until there is one, this
    /// is a constant and the field exists so the contract is honoured.
    public static let policyVersion = "2026-07-27"

    public init(
        repository: any TelemetryRepository,
        scopes: any AccountScopeResolving,
        collectors: [any TelemetryConsentApplying] = [],
        sync: (any PrivacySettingsSyncing)? = nil,
        dates: any DateProviding = SystemDateProvider()
    ) {
        self.repository = repository
        self.scopes = scopes
        self.collectors = collectors
        self.sync = sync
        self.dates = dates
        consent = .unasked(policyVersion: Self.policyVersion, now: dates.now())
    }

    public func load() async {
        let scope = await scopes.currentScope()
        if let stored = try? await repository.privacySettings(for: scope),
            let restored = Self.consent(from: stored)
        {
            consent = restored
        }
        // The collectors start from whatever the device last knew rather than
        // from a default: a relaunch must not re-enable collection somebody
        // turned off before it.
        await applyToCollectors(consent)
        isLoaded = true
    }

    public func setProductAnalytics(granted: Bool) async {
        await apply { current in
            TelemetryConsent(
                productAnalytics: granted ? .granted : .denied,
                diagnostics: current.diagnostics,
                policyVersion: Self.policyVersion,
                version: current.version,
                updatedAt: self.dates.now()
            )
        }
    }

    public func setDiagnostics(granted: Bool) async {
        await apply { current in
            TelemetryConsent(
                productAnalytics: current.productAnalytics,
                diagnostics: granted ? .granted : .denied,
                policyVersion: Self.policyVersion,
                version: current.version,
                updatedAt: self.dates.now()
            )
        }
    }

    private func apply(_ change: (TelemetryConsent) -> TelemetryConsent) async {
        let scope = await scopes.currentScope()
        let updated = change(consent)
        guard updated != consent else { return }
        consent = updated
        didReloadAfterConflict = false
        try? await repository.savePrivacySettings(Self.record(from: updated), for: scope)
        // Before the network, always: a withdrawal has to take effect on this
        // device whether or not anything can be reached.
        await applyToCollectors(updated)

        // A guest has no account-side settings to write. The version stays
        // where it is so the first account write starts from what the server
        // knows rather than from a number this device invented.
        guard let sync, !scope.isGuest else { return }
        switch try? await sync.update(updated) {
        case .updated(let accepted):
            consent = accepted
            try? await repository.savePrivacySettings(Self.record(from: accepted), for: scope)
            await applyToCollectors(accepted)
        case .conflict(let server):
            if let server {
                consent = server
                try? await repository.savePrivacySettings(Self.record(from: server), for: scope)
                await applyToCollectors(server)
            }
            didReloadAfterConflict = true
        case nil:
            // The decision is stored and applied locally; the next sync offers
            // it again. A failed round trip must not cost the answer somebody
            // gave.
            break
        }
    }

    private func applyToCollectors(_ consent: TelemetryConsent) async {
        for collector in collectors {
            await collector.adopt(consent: consent)
        }
    }

    // MARK: - Mapping

    private static func consent(from record: PrivacySettingsRecord) -> TelemetryConsent? {
        guard let product = ConsentStatus(rawValue: record.productAnalyticsStatus),
            let diagnostics = ConsentStatus(rawValue: record.diagnosticsStatus)
        else {
            return nil
        }
        return TelemetryConsent(
            productAnalytics: product,
            diagnostics: diagnostics,
            policyVersion: record.policyVersion,
            version: record.version,
            updatedAt: record.updatedAt
        )
    }

    private static func record(from consent: TelemetryConsent) -> PrivacySettingsRecord {
        PrivacySettingsRecord(
            productAnalyticsStatus: consent.productAnalytics.rawValue,
            diagnosticsStatus: consent.diagnostics.rawValue,
            policyVersion: consent.policyVersion,
            version: consent.version,
            updatedAt: consent.updatedAt
        )
    }
}
