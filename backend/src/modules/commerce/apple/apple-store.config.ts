import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StoreEnvironment } from "@prisma/client";

import type {
  AppleStoreEnvironment,
  EnvironmentVariables,
} from "../../../config/environment.validation";

const STORE_ENVIRONMENT: Record<AppleStoreEnvironment, StoreEnvironment> = {
  LOCAL_TEST: StoreEnvironment.LOCAL_TEST,
  SANDBOX: StoreEnvironment.SANDBOX,
  PRODUCTION: StoreEnvironment.PRODUCTION,
};

/**
 * Everything this deployment knows about the App Store it is allowed to
 * believe, read once at startup and never from a request.
 *
 * Two properties of the shape matter more than the values:
 *
 * - the store environment is decided by the deployment (see
 *   `resolveAppleStoreEnvironment`), so nothing a client sends can move a
 *   Sandbox purchase into production or the reverse;
 * - being unconfigured is a state, not a failure. The tables, the guard and
 *   these endpoints ship before App Store Connect has an app record to point
 *   at, so an unconfigured deployment answers a submission with a stable code
 *   instead of refusing to start.
 */
@Injectable()
export class AppleStoreConfig {
  readonly storeEnvironment: StoreEnvironment;
  readonly bundleId: string;
  readonly appAppleId: number | null;
  readonly rootCertificates: Buffer[];
  /**
   * The App Store Server API credential, and the reason it is read here but
   * used nowhere in the request path: it is the key that can ask Apple
   * anything about anybody's purchases, and it belongs to the reconciliation
   * job alone (§8). Empty strings mean "not issued yet", which is a state a
   * deployment ships in rather than a failure to start.
   */
  readonly keyId: string;
  readonly issuerId: string;
  readonly privateKey: string;
  /**
   * Certificate revocation and expiry are checked against Apple over the
   * network, which is right for a real store and wrong for the local
   * StoreKit configuration, whose payloads are not signed by Apple at all.
   */
  readonly onlineChecks: boolean;
  /**
   * Whether this build may run the local test verifier at all.
   *
   * A production artifact never enables it (§14), whatever deployment it is
   * pointed at. `DEPLOYMENT_ENV` already keeps `LOCAL_TEST` away from dev and
   * prod; this keeps it away from the release image itself, so a production
   * container started against a disposable deployment boots and verifies
   * nothing rather than believing payloads Apple never signed.
   */
  readonly localTestAllowed: boolean;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const environment = config.getOrThrow<AppleStoreEnvironment>(
      "COMMERCE_APPLE_STORE_ENVIRONMENT",
    );
    this.storeEnvironment = STORE_ENVIRONMENT[environment];
    this.bundleId = config.getOrThrow<string>("COMMERCE_APPLE_BUNDLE_ID");
    // Read rather than demanded: an app with no App Store record yet has no
    // Apple id, and `getOrThrow` is for keys whose absence is a mistake.
    const appAppleId = config.get<number | null>("COMMERCE_APPLE_APP_APPLE_ID");
    this.appAppleId = typeof appAppleId === "number" ? appAppleId : null;
    this.rootCertificates = config
      .getOrThrow<string[]>("COMMERCE_APPLE_ROOT_CERTIFICATES")
      .map((certificate) => Buffer.from(certificate, "base64"));
    // Read as three values, as they are validated: they are set together or
    // not at all, and the validator has already refused a half-set.
    this.keyId = config.getOrThrow<string>("COMMERCE_APPLE_IAP_KEY_ID");
    this.issuerId = config.getOrThrow<string>("COMMERCE_APPLE_IAP_ISSUER_ID");
    this.privateKey = config.getOrThrow<string>(
      "COMMERCE_APPLE_IAP_PRIVATE_KEY",
    );
    this.onlineChecks = this.storeEnvironment !== StoreEnvironment.LOCAL_TEST;
    this.localTestAllowed =
      config.getOrThrow<string>("NODE_ENV") !== "production";
  }

  /**
   * Whether a signed transaction can be checked at all.
   *
   * Production additionally needs the app's Apple id: it is what ties the
   * bundle identifier to one App Store record, and Apple's own library
   * refuses to be built for Production without it.
   */
  /** Whether this deployment can call the App Store Server API at all. */
  get apiCredentialPresent(): boolean {
    return (
      this.keyId.length > 0 &&
      this.issuerId.length > 0 &&
      this.privateKey.length > 0
    );
  }

  get configured(): boolean {
    if (this.bundleId.length === 0) {
      return false;
    }
    if (this.storeEnvironment === StoreEnvironment.LOCAL_TEST) {
      return this.localTestAllowed;
    }
    if (this.rootCertificates.length === 0) {
      return false;
    }
    return (
      this.storeEnvironment !== StoreEnvironment.PRODUCTION ||
      this.appAppleId !== null
    );
  }
}
