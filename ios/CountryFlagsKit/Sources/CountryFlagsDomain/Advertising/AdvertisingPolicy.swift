import Foundation

public enum AdFormat: String, Hashable, Sendable, Codable, CaseIterable {
    case banner = "BANNER"
    case native = "NATIVE"
    case interstitial = "INTERSTITIAL"
    case rewarded = "REWARDED"
}

/// A place where an ad could appear.
///
/// The list mirrors `contracts/registries/ad-placements.json`. Nothing renders
/// in the MVP: the registry exists so the boundary is fixed before a provider
/// is chosen, and so a surface the product decided against cannot be added by
/// passing a string.
public enum AdPlacement: String, Hashable, Sendable, Codable, CaseIterable {
    case homeBottomBanner = "home.bottom_banner"
    case catalogInlineNative = "catalog.inline_native"
    case sessionResultInterstitial = "session_result.interstitial"
    case rewardedOptionalBonus = "rewarded.optional_bonus"

    public var format: AdFormat {
        switch self {
        case .homeBottomBanner: .banner
        case .catalogInlineNative: .native
        case .sessionResultInterstitial: .interstitial
        case .rewardedOptionalBonus: .rewarded
        }
    }

    /// The flag that has to be on before this placement is even considered.
    public var featureFlag: BooleanFeatureFlag {
        switch self {
        case .homeBottomBanner: .adsHomeBottomBannerEnabled
        case .catalogInlineNative: .adsCatalogInlineNativeEnabled
        case .sessionResultInterstitial: .adsSessionResultInterstitialEnabled
        case .rewardedOptionalBonus: .adsRewardedOptionalBonusEnabled
        }
    }
}

public enum AdvertisingMode: String, Hashable, Sendable, Codable {
    case disabled = "DISABLED"
    /// Contextual ads without cross-app tracking, which needs no ATT prompt.
    case contextualOnly = "CONTEXTUAL_ONLY"
}

public struct AdPlacementPolicy: Hashable, Sendable, Codable {
    public let enabled: Bool
    public let format: AdFormat

    public init(enabled: Bool, format: AdFormat) {
        self.enabled = enabled
        self.format = format
    }
}

/// The server half of the advertising decision.
public struct AdvertisingPolicy: Hashable, Sendable, Codable {
    public let policyVersion: String
    public let enabled: Bool
    public let mode: AdvertisingMode
    public let placements: [String: AdPlacementPolicy]
    public let refreshAfter: Date

    public init(
        policyVersion: String,
        enabled: Bool,
        mode: AdvertisingMode,
        placements: [String: AdPlacementPolicy],
        refreshAfter: Date
    ) {
        self.policyVersion = policyVersion
        self.enabled = enabled
        self.mode = mode
        self.placements = placements
        self.refreshAfter = refreshAfter
    }

    public func policy(for placement: AdPlacement) -> AdPlacementPolicy? {
        placements[placement.rawValue]
    }

    /// What the client assumes before a snapshot arrives, and what it falls
    /// back to when one is refused.
    public static let off = AdvertisingPolicy(
        policyVersion: "bundled-off",
        enabled: false,
        mode: .disabled,
        placements: [:],
        refreshAfter: .distantPast
    )
}
