import Foundation
import OpenAPIRuntime

import CountryFlagsDomain

/// Reads `GET /v1/app-config` and turns it into domain values.
///
/// The generated DTOs stop here. What leaves is a `FeatureFlagSnapshot` and an
/// `AdvertisingPolicy`, so a contract change cannot reach a screen, and neither
/// can a key, a type or a placement this build does not understand: anything
/// unrecognized is dropped rather than guessed at.
public struct AppConfigurationRepository: AppConfigurationFetching {
    private let factory: APIClientFactory
    private let dates: any DateProviding

    /// How long a revalidated snapshot stays fresh.
    ///
    /// A `304` carries no body and the contract models no headers on it, so the
    /// client applies its own window. It matches the lifetime the contract
    /// documents for a full snapshot.
    public static let revalidationLifetime: TimeInterval = 15 * 60

    public init(factory: APIClientFactory, dates: any DateProviding = SystemDateProvider()) {
        self.factory = factory
        self.dates = dates
    }

    public func fetch(
        context: FeatureFlagContext,
        entityTag: String?
    ) async throws -> AppConfigurationFetchResult {
        let response: Operations.getAppConfig.Output
        do {
            response = try await factory.makeClient().getAppConfig(
                Operations.getAppConfig.Input(
                    query: .init(
                        platform: .ios,
                        appVersion: context.appVersion,
                        locale: context.locale
                    ),
                    headers: .init(If_hyphen_None_hyphen_Match: entityTag)
                )
            )
        } catch {
            throw APIError.from(error)
        }

        switch response {
        case .notModified:
            return .notModified(
                revalidatedUntil: dates.now().addingTimeInterval(Self.revalidationLifetime)
            )
        case .ok(let ok):
            let body = try ok.body.json
            return .updated(
                AppConfiguration(
                    snapshot: FeatureFlagSnapshot(
                        configVersion: body.configVersion,
                        contextKey: context.cacheKey,
                        fetchedAt: body.generatedAt,
                        expiresAt: body.expiresAt,
                        flags: Self.flags(from: body.featureFlags.additionalProperties),
                        entityTag: ok.headers.ETag
                    ),
                    advertising: Self.advertising(from: body.advertising)
                )
            )
        case .default(let statusCode, _):
            // Not reached in practice: the error mapping middleware turns every
            // failed status into an `APIError` before the generated client
            // decodes it. The case stays exhaustive so a change there cannot
            // turn a failure into a silent success here.
            throw APIError.status(
                APIErrorDetails(
                    statusCode: statusCode,
                    code: "UNKNOWN",
                    message: "",
                    requestID: nil
                )
            )
        }
    }

    // MARK: Mapping

    private static func flags(
        from payload: [String: Components.Schemas.evaluatedFlag]
    ) -> [String: EvaluatedFeatureFlag] {
        var result: [String: EvaluatedFeatureFlag] = [:]
        for (key, evaluated) in payload {
            // A key the build does not know is ignored: the backend may serve
            // several client versions, and an unknown flag is not an error.
            guard let definition = FeatureFlagRegistry.definition(forKey: key) else { continue }
            guard let flag = flag(from: evaluated), flag.value.type == definition.type else {
                continue
            }
            result[key] = flag
        }
        return result
    }

    private static func flag(
        from evaluated: Components.Schemas.evaluatedFlag
    ) -> EvaluatedFeatureFlag? {
        switch evaluated {
        case .booleanFlag(let flag):
            return make(
                declaredType: flag._type,
                expected: .boolean,
                value: .boolean(flag.value),
                variant: flag.variant,
                activationPolicy: flag.activationPolicy
            )
        case .stringFlag(let flag):
            return make(
                declaredType: flag._type,
                expected: .string,
                value: .string(flag.value),
                variant: flag.variant,
                activationPolicy: flag.activationPolicy
            )
        case .numberFlag(let flag):
            return make(
                declaredType: flag._type,
                expected: .number,
                value: .number(flag.value),
                variant: flag.variant,
                activationPolicy: flag.activationPolicy
            )
        }
    }

    /// The `oneOf` is decoded by shape, so a payload that declares one type and
    /// carries another still decodes — as the other type. Comparing the
    /// declared discriminator with the case that matched is what turns that into
    /// a rejected value instead of a silently reinterpreted one.
    private static func make(
        declaredType: OpenAPIValueContainer,
        expected: FeatureFlagValueType,
        value: FeatureFlagValue,
        variant: String,
        activationPolicy: OpenAPIValueContainer
    ) -> EvaluatedFeatureFlag? {
        guard string(from: declaredType) == expected.rawValue,
            let rawPolicy = string(from: activationPolicy),
            let policy = FeatureFlagActivationPolicy(rawValue: rawPolicy)
        else { return nil }
        return EvaluatedFeatureFlag(value: value, variant: variant, activationPolicy: policy)
    }

    private static func advertising(
        from payload: Components.Schemas.advertisingPolicy
    ) -> AdvertisingPolicy {
        guard let rawMode = string(from: payload.mode),
            let mode = AdvertisingPolicy.Mode(rawValue: rawMode)
        else {
            // A mode this build does not understand means advertising stays off.
            return .disabled
        }

        var placements: [AdPlacement: AdvertisingPolicy.PlacementPolicy] = [:]
        for (key, placementPayload) in payload.placements.additionalProperties {
            guard let placement = AdPlacementRegistry.placement(forKey: key),
                let rawFormat = string(from: placementPayload.format),
                let format = AdFormat(rawValue: rawFormat)
            else { continue }
            placements[placement] = AdvertisingPolicy.PlacementPolicy(
                isEnabled: placementPayload.enabled,
                format: format
            )
        }

        return AdvertisingPolicy(
            policyVersion: payload.policyVersion,
            isEnabled: payload.enabled,
            mode: mode,
            placements: placements,
            refreshAfter: payload.refreshAfter
        )
    }

    private static func string(from container: OpenAPIValueContainer) -> String? {
        container.value as? String
    }
}
