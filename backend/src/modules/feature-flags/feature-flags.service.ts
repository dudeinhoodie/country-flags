import {
  Injectable,
  Inject,
  HttpStatus,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import {
  OpenFeature,
  type EvaluationContext,
  type Provider,
} from "@openfeature/server-sdk";

import { ApiException } from "../../common/http/api.exception";
import { JsonLoggerService } from "../../common/logging/json-logger.service";
import {
  FEATURE_FLAGS,
  getFeatureFlag,
  type FeatureFlagDefinition,
  type FeatureFlagValue,
} from "./feature-flag.registry";

/** Nest boundary for replacing the local provider with an approved control plane. */
export const FEATURE_FLAG_PROVIDER = Symbol("FEATURE_FLAG_PROVIDER");
const EVALUATION_TIMEOUT_MS = 200;

export interface FeatureFlagContext {
  platform: "android" | "ios" | "web";
  appVersion: string;
  locale: string;
  accountId?: string;
}

export interface EvaluatedFlag {
  type: "boolean" | "number" | "string";
  value: FeatureFlagValue;
  variant: string;
  activationPolicy: "immediate" | "nextLaunch" | "nextSession";
}

function toEvaluationContext(context: FeatureFlagContext): EvaluationContext {
  return {
    platform: context.platform,
    appVersion: context.appVersion,
    locale: context.locale,
    ...(context.accountId === undefined
      ? {}
      : { targetingKey: context.accountId }),
  };
}

function validValue(
  definition: FeatureFlagDefinition,
  value: FeatureFlagValue,
): boolean {
  if (typeof value !== definition.type) return false;
  if (
    definition.type === "string" &&
    definition.allowedValues !== undefined &&
    !definition.allowedValues.includes(value as string)
  ) {
    return false;
  }
  return !(
    definition.type === "number" &&
    ((definition.minimum !== undefined &&
      (value as number) < definition.minimum) ||
      (definition.maximum !== undefined &&
        (value as number) > definition.maximum))
  );
}

async function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Feature flag evaluation timed out")),
          EVALUATION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

@Injectable()
export class FeatureFlagsService implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly logger: JsonLoggerService,
    @Inject(FEATURE_FLAG_PROVIDER) private readonly provider: Provider,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await OpenFeature.setProviderAndWait(this.provider);
    } catch (error) {
      this.logger.warn({
        message:
          "Feature flag provider initialization failed; defaults remain active",
        event: "feature_flag_provider_initialization_failed",
        errorClass: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await OpenFeature.close();
  }

  async evaluate(
    key: string,
    context: FeatureFlagContext,
  ): Promise<EvaluatedFlag> {
    const definition = getFeatureFlag(key);
    const evaluationContext = toEvaluationContext(context);
    const client = OpenFeature.getClient("country-flags");
    try {
      const details =
        definition.type === "boolean"
          ? await withTimeout(
              client.getBooleanDetails(
                definition.key,
                definition.defaultValue as boolean,
                evaluationContext,
              ),
            )
          : definition.type === "number"
            ? await withTimeout(
                client.getNumberDetails(
                  definition.key,
                  definition.defaultValue as number,
                  evaluationContext,
                ),
              )
            : await withTimeout(
                client.getStringDetails(
                  definition.key,
                  definition.defaultValue as string,
                  evaluationContext,
                ),
              );
      if (details.errorCode !== undefined) {
        throw new Error("OpenFeature evaluation returned a provider error");
      }
      const value = validValue(definition, details.value)
        ? details.value
        : definition.defaultValue;
      return {
        type: definition.type,
        value,
        variant: details.variant ?? "default",
        activationPolicy: definition.activationPolicy,
      };
    } catch (error) {
      this.logger.warn({
        message: "Feature flag evaluation failed; registry default was used",
        event: "feature_flag_default_used",
        feature: definition.key,
        errorClass: error instanceof Error ? error.name : "UnknownError",
      });
      return {
        type: definition.type,
        value: definition.defaultValue,
        variant: "default",
        activationPolicy: definition.activationPolicy,
      };
    }
  }

  async getBoolean(
    key: string,
    fallback: boolean,
    context: FeatureFlagContext,
  ): Promise<boolean> {
    const definition = FEATURE_FLAGS.get(key);
    if (definition === undefined || definition.type !== "boolean") {
      return fallback;
    }
    const evaluated = await this.evaluate(key, context);
    return typeof evaluated.value === "boolean" ? evaluated.value : fallback;
  }

  async requireBoolean(
    key: string,
    context: FeatureFlagContext,
  ): Promise<void> {
    if (!(await this.getBoolean(key, false, context))) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "FEATURE_DISABLED",
        "This capability is currently unavailable",
        { feature: key },
      );
    }
  }

  async clientSnapshot(
    context: FeatureFlagContext,
  ): Promise<Record<string, EvaluatedFlag>> {
    const entries = await Promise.all(
      [...FEATURE_FLAGS.values()]
        .filter(({ clientVisible }) => clientVisible)
        .map(
          async ({ key }) => [key, await this.evaluate(key, context)] as const,
        ),
    );
    return Object.fromEntries(entries);
  }
}
