import Foundation

import CountryFlagsDomain

/// Tells the server when a signed-in learner's device is in a different time
/// zone from the one their day is counted in (#452).
///
/// The server takes the zone at registration and never again, so a learner
/// who moves goes on having their day, and their daily limit, counted in the
/// place they left. The device is the only thing that knows it moved.
///
/// It asks nothing when nothing changed. The zone the server was last brought
/// in line with is remembered per account, and a launch or a return to the app
/// in that same zone makes no request. Only a new zone reads the server's, and
/// only a zone that differs from the server's is sent. A zone the server
/// refuses (422) is remembered too, so it is not offered again on every return
/// to the app; the next move is.
///
/// Failures are quiet: a network that is not there, or a session that is not,
/// leaves nothing remembered, and the next launch or return tries again.
public actor AccountTimeZoneReporter {
    private let syncing: any AccountTimeZoneSyncing
    private let scopes: any AccountScopeResolving
    private let learning: any LearningRepository
    private let records: any TimeZoneReportRecording
    private let currentZone: @Sendable () -> String
    private let logger: any AppLogging

    /// The report in flight. Launch, a return to the app and a sign-in can
    /// all ask at once, and one request answers all of them.
    private var inFlight: Task<Void, Never>?

    public init(
        syncing: any AccountTimeZoneSyncing,
        scopes: any AccountScopeResolving,
        learning: any LearningRepository,
        records: any TimeZoneReportRecording,
        currentZone: @escaping @Sendable () -> String = {
            TimeZone.autoupdatingCurrent.identifier
        },
        logger: any AppLogging = NoOpLogger()
    ) {
        self.syncing = syncing
        self.scopes = scopes
        self.learning = learning
        self.records = records
        self.currentZone = currentZone
        self.logger = logger
    }

    public func reportIfMoved() async {
        if let inFlight {
            await inFlight.value
            return
        }
        let task = Task { await self.report() }
        inFlight = task
        await task.value
        inFlight = nil
    }

    private func report() async {
        let scope = await scopes.currentScope()
        // A guest's day is counted on the device; there is no server zone.
        guard case .authenticated(let userID) = scope else { return }
        let zone = currentZone()
        guard !zone.isEmpty, records.reportedTimeZone(for: userID) != zone else { return }

        do {
            // Two tries: a version that moved between the read and the write
            // is read again once, and a second conflict waits for next time.
            for _ in 0..<2 {
                guard let held = try await syncing.accountTimeZone() else { return }
                if Self.isSame(held.identifier, zone) {
                    records.recordReportedTimeZone(zone, for: userID)
                    return
                }
                switch try await syncing.updateTimeZone(zone, basedOn: held.settingsVersion) {
                case .updated(let settings):
                    records.recordReportedTimeZone(zone, for: userID)
                    // The version moved. Stored now, so the next switch a
                    // learner flips is not refused as another device's write.
                    try? await learning.saveSettings(settings, for: scope)
                    logger.log(.info, .sync, "The account's time zone followed the device")
                    return
                case .refused:
                    records.recordReportedTimeZone(zone, for: userID)
                    // The zone itself stays out of the log: it says where
                    // somebody is.
                    logger.log(.notice, .sync, "The server does not know the device's time zone")
                    return
                case .conflict:
                    continue
                }
            }
        } catch {
            logger.log(
                .info,
                .sync,
                "The time zone could not be reported and will be tried again"
            )
        }
    }

    /// The server may store a zone as PostgreSQL spells it, which can differ
    /// from the device's in case only.
    private static func isSame(_ held: String, _ device: String) -> Bool {
        held.caseInsensitiveCompare(device) == .orderedSame
    }
}

/// Keeps the reported zones in the device's defaults: device bookkeeping, one
/// entry per account that signed in here.
public struct UserDefaultsTimeZoneReportStore: TimeZoneReportRecording, @unchecked Sendable {
    private static let prefix = "settings.timezone.reported."

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func reportedTimeZone(for userID: UUID) -> String? {
        defaults.string(forKey: Self.prefix + userID.uuidString.lowercased())
    }

    public func recordReportedTimeZone(_ identifier: String, for userID: UUID) {
        defaults.set(identifier, forKey: Self.prefix + userID.uuidString.lowercased())
    }
}
