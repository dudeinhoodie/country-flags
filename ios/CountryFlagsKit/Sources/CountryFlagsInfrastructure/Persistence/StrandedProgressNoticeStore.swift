import Foundation

import CountryFlagsDomain

/// Keeps the notice in the device's defaults.
///
/// Beside the store rather than in it, like the manifest's entity tag: it
/// describes a catalogue change, which is the same for every account on the
/// device, and it is dropped as soon as somebody has read it.
public struct UserDefaultsStrandedProgressNoticeStore: StrandedProgressNoticing, @unchecked Sendable
{
    private static let key = "progress.stranded.notice"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func pendingNotice() -> StrandedProgressNotice? {
        guard let data = defaults.data(forKey: Self.key) else { return nil }
        return try? JSONDecoder().decode(StrandedProgressNotice.self, from: data)
    }

    public func store(_ notice: StrandedProgressNotice) {
        guard let data = try? JSONEncoder().encode(notice) else { return }
        defaults.set(data, forKey: Self.key)
    }

    public func clearNotice() {
        defaults.removeObject(forKey: Self.key)
    }
}
