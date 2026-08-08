import Foundation
import OpenAPIRuntime

import CountryFlagsDomain

public enum AppConfigFetchResult: Hashable, Sendable {
    case updated(AppConfigSnapshot)
    /// The entity tag still matches, so the cached snapshot stands.
    case notModified
}

/// Fetches the evaluated configuration.
///
/// The generated DTO never leaves this type: everything above it works with
/// `AppConfigSnapshot`, whose fields this build actually knows how to use.
public struct AppConfigService: Sendable {
    private let clientFactory: APIClientFactory
    private let dates: any DateProviding

    public init(clientFactory: APIClientFactory, dates: any DateProviding = SystemDateProvider()) {
        self.clientFactory = clientFactory
        self.dates = dates
    }

    /// - Parameter entityTag: the tag of the cached snapshot, replayed as
    ///   `If-None-Match` so an unchanged configuration costs a 304 and no body.
    public func fetch(
        context: FeatureFlagContext,
        entityTag: String? = nil
    ) async throws -> AppConfigFetchResult {
        let client = clientFactory.makeClient()
        let output: Operations.getAppConfig.Output
        do {
            output = try await client.getAppConfig(
                query: .init(
                    platform: platform(for: context.platform),
                    appVersion: context.appVersion,
                    locale: context.locale
                ),
                headers: .init(If_hyphen_None_hyphen_Match: entityTag)
            )
        } catch {
            throw APIError.from(error)
        }

        switch output {
        case .notModified:
            return .notModified
        case .ok(let response):
            let payload = try response.body.json
            return .updated(
                Self.snapshot(
                    from: payload,
                    scopeKey: context.scope.key,
                    entityTag: response.headers.ETag,
                    fetchedAt: dates.now()
                )
            )
        case .default(let statusCode, _):
            // Unreachable in practice: the error mapping middleware turns every
            // status at or above 400 into an `APIError` before the generated
            // client parses it. The case is handled rather than ignored so a
            // contract change cannot silently produce a success here.
            throw APIError.status(
                APIErrorDetails(
                    statusCode: statusCode,
                    code: "UNKNOWN",
                    message: "Unmapped error response",
                    requestID: nil
                )
            )
        }
    }

    private func platform(for value: String) -> Components.Parameters.Platform {
        Components.Parameters.Platform(rawValue: value) ?? .ios
    }

    /// Maps the contract payload onto what this build can act on.
    ///
    /// Every unknown key, mismatched type and unusable enum value is dropped
    /// rather than stored: the resolver then answers from the bundled default,
    /// which is a value this build is known to render.
    static func snapshot(
        from payload: Components.Schemas.app_hyphen_config_period_v1_period_schema,
        scopeKey: String,
        entityTag: String?,
        fetchedAt: Date
    ) -> AppConfigSnapshot {
        var flags: [String: EvaluatedFeatureFlag] = [:]
        for (key, evaluated) in payload.featureFlags.additionalProperties {
            guard let definition = FeatureFlagRegistry.definition(forKey: key),
                let flag = evaluatedFlag(from: evaluated),
                definition.accepts(flag.value)
            else {
                continue
            }
            flags[key] = flag
        }

        return AppConfigSnapshot(
            configVersion: payload.configVersion,
            generatedAt: payload.generatedAt,
            expiresAt: payload.expiresAt,
            fetchedAt: fetchedAt,
            scopeKey: scopeKey,
            entityTag: entityTag,
            contentVersion: payload.contentVersion,
            supportedTemplateSchemaVersions: payload.supportedTemplateSchemaVersions,
            clientVersionPolicy: clientVersionPolicy(from: payload.minimumClientVersions.ios),
            flags: flags,
            advertising: advertisingPolicy(from: payload.advertising),
            origin: .remote
        )
    }

    private static func evaluatedFlag(
        from evaluated: Components.Schemas.evaluatedFlag
    ) -> EvaluatedFeatureFlag? {
        // The contract writes `type` as a constant, which the generator renders
        // as an untyped container. A payload whose declared type disagrees with
        // the value it carries is refused: guessing which of the two is right
        // is how a screen gets handed something it cannot draw.
        switch evaluated {
        case .booleanFlag(let flag):
            guard string(flag._type) == "boolean",
                let policy = activationPolicy(flag.activationPolicy)
            else { return nil }
            return EvaluatedFeatureFlag(
                value: .boolean(flag.value),
                variant: flag.variant,
                activationPolicy: policy
            )
        case .stringFlag(let flag):
            guard string(flag._type) == "string",
                let policy = activationPolicy(flag.activationPolicy)
            else { return nil }
            return EvaluatedFeatureFlag(
                value: .string(flag.value),
                variant: flag.variant,
                activationPolicy: policy
            )
        case .numberFlag(let flag):
            guard string(flag._type) == "number",
                let policy = activationPolicy(flag.activationPolicy)
            else { return nil }
            return EvaluatedFeatureFlag(
                value: .number(flag.value),
                variant: flag.variant,
                activationPolicy: policy
            )
        }
    }

    private static func clientVersionPolicy(
        from payload: Components.Schemas.clientVersionPolicy
    ) -> ClientVersionPolicy {
        ClientVersionPolicy(
            minimumSupported: payload.minimumSupported,
            latest: payload.latest,
            // An update mode this build does not know is treated as no update
            // rather than as a forced one: a client must not lock itself out
            // because a newer value appeared.
            updateMode: string(payload.updateMode)
                .flatMap(ClientVersionPolicy.UpdateMode.init(rawValue:)) ?? .none
        )
    }

    private static func advertisingPolicy(
        from payload: Components.Schemas.advertisingPolicy
    ) -> AdvertisingPolicy {
        guard let mode = string(payload.mode).flatMap(AdvertisingMode.init(rawValue:)) else {
            // An unknown mode is not a reason to guess. Advertising stays off.
            return .off
        }

        var placements: [String: AdPlacementPolicy] = [:]
        for (key, placement) in payload.placements.additionalProperties {
            guard AdPlacement(rawValue: key) != nil,
                let format = string(placement.format).flatMap(AdFormat.init(rawValue:))
            else {
                continue
            }
            placements[key] = AdPlacementPolicy(enabled: placement.enabled, format: format)
        }

        return AdvertisingPolicy(
            policyVersion: payload.policyVersion,
            enabled: payload.enabled,
            mode: mode,
            placements: placements,
            refreshAfter: payload.refreshAfter
        )
    }

    private static func activationPolicy(
        _ container: OpenAPIRuntime.OpenAPIValueContainer
    ) -> FeatureFlagActivationPolicy? {
        string(container).flatMap(FeatureFlagActivationPolicy.init(rawValue:))
    }

    private static func string(_ container: OpenAPIRuntime.OpenAPIValueContainer?) -> String? {
        container?.value as? String
    }
}
