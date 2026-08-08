import Foundation

/// The formats the architecture can describe. Listing one here is not
/// permission to ship it: every placement needs its own product and privacy
/// approval first.
public enum AdFormat: String, Hashable, Sendable, CaseIterable {
    case banner = "BANNER"
    case native = "NATIVE"
    case interstitial = "INTERSTITIAL"
    case rewarded = "REWARDED"
}

/// Where in the app a request comes from.
///
/// A placement is bound to its surfaces, so an adapter cannot present a unit on
/// a screen the policy never approved.
public enum AdSurface: String, Hashable, Sendable, CaseIterable {
    case home = "HOME"
    case catalog = "CATALOG"
    case sessionResult = "SESSION_RESULT"
    case optionalBonus = "OPTIONAL_BONUS"
}

/// The registered places an ad could appear. All of them are off.
public enum AdPlacement: String, Hashable, Sendable, CaseIterable {
    case homeBottomBanner = "home.bottom_banner"
    case catalogInlineNative = "catalog.inline_native"
    case sessionResultInterstitial = "session_result.interstitial"
    case rewardedOptionalBonus = "rewarded.optional_bonus"

    public var key: String { rawValue }

    public var format: AdFormat {
        switch self {
        case .homeBottomBanner: .banner
        case .catalogInlineNative: .native
        case .sessionResultInterstitial: .interstitial
        case .rewardedOptionalBonus: .rewarded
        }
    }

    /// The kill switch of this placement. The global `ads.enabled` gates it in
    /// addition, so one flag can stop everything.
    public var featureFlag: BooleanFeatureFlag {
        switch self {
        case .homeBottomBanner: .adsHomeBottomBannerEnabled
        case .catalogInlineNative: .adsCatalogInlineNativeEnabled
        case .sessionResultInterstitial: .adsSessionResultInterstitialEnabled
        case .rewardedOptionalBonus: .adsRewardedOptionalBonusEnabled
        }
    }

    public var allowedSurfaces: Set<AdSurface> {
        switch self {
        case .homeBottomBanner: [.home]
        case .catalogInlineNative: [.catalog]
        case .sessionResultInterstitial: [.sessionResult]
        case .rewardedOptionalBonus: [.optionalBonus]
        }
    }

    public var isApprovedForRelease: Bool {
        AdPlacementRegistry.approvedForRelease.contains(self)
    }

    public var owner: String { "monetization" }
}

/// The registry as the rest of the app sees it.
public enum AdPlacementRegistry {
    public static let placements = AdPlacement.allCases

    /// Nothing has passed product and privacy review, so nothing may be
    /// presented even if every flag were switched on. Composition hands this set
    /// to the eligibility rules rather than the rules reading it themselves, so
    /// the checks after it can be exercised without pretending a placement was
    /// approved.
    public static let approvedForRelease: Set<AdPlacement> = []

    /// A key the build does not know is ignored rather than guessed at, which
    /// is what keeps a future backend policy from inventing a surface.
    public static func placement(forKey key: String) -> AdPlacement? {
        AdPlacement(rawValue: key)
    }
}
