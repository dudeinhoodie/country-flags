import { ConfigService } from "@nestjs/config";
import { StoreEnvironment } from "@prisma/client";

import {
  type EnvironmentVariables,
  validateEnvironment,
} from "../../../config/environment.validation";
import { AppleStoreConfig } from "./apple-store.config";

const CERTIFICATE = Buffer.from([0x30, 0x82, 0x01, 0x02]).toString("base64");

const LOCAL = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:password@localhost:5432/country_flags",
};

const HOSTED = {
  ...LOCAL,
  NODE_ENV: "production",
  DEPLOYMENT_ENV: "dev",
  DIRECT_DATABASE_URL:
    "postgresql://user:password@direct.localhost:5432/country_flags",
  SERVICE_RELEASE: "0e7c1a9",
  AUTH_PROVIDER_TEST_TOKENS_ENABLED: "false",
  AUTH_ACCESS_TOKEN_SECRET: "production-access-secret-with-at-least-32-chars",
  AUTH_ACCESS_TOKEN_ISSUER: "https://api.country-flags.example",
  AUTH_ACCESS_TOKEN_AUDIENCE: "country-flags-api",
  AUTH_RATE_LIMIT_SECRET: "production-rate-limit-secret-with-at-least-32-ch",
  ACCOUNT_DATA_HASH_SECRET: "production-account-data-secret-with-at-least-32c",
  PUBLIC_BASE_URL: "https://api.country-flags.example",
  APPLE_CLIENT_IDS: "com.countryflags.ios",
  GOOGLE_CLIENT_IDS: "web.apps.googleusercontent.com",
};

function storeConfig(config: Record<string, unknown>): AppleStoreConfig {
  return new AppleStoreConfig(
    new ConfigService<EnvironmentVariables, true>(validateEnvironment(config)),
  );
}

describe("AppleStoreConfig", () => {
  it("verifies against the store its deployment is pinned to", () => {
    expect(storeConfig(LOCAL).storeEnvironment).toBe(
      StoreEnvironment.LOCAL_TEST,
    );
    expect(storeConfig(HOSTED).storeEnvironment).toBe(StoreEnvironment.SANDBOX);
  });

  it("checks revocation with Apple everywhere the store is real", () => {
    // And nowhere it is not: the local StoreKit configuration is signed by
    // nobody, so there is no certificate to ask Apple about.
    expect(storeConfig(LOCAL).onlineChecks).toBe(false);
    expect(storeConfig(HOSTED).onlineChecks).toBe(true);
  });

  it("is simply unconfigured until the deployment has an app record", () => {
    const store = storeConfig(HOSTED);

    expect(store.configured).toBe(false);
    expect(store.bundleId).toBe("");
    expect(store.rootCertificates).toEqual([]);
    expect(store.appAppleId).toBeNull();
  });

  it("needs Apple's root certificates before it will believe a Sandbox purchase", () => {
    expect(
      storeConfig({
        ...HOSTED,
        COMMERCE_APPLE_BUNDLE_ID: "app.countryflags.mobile.dev",
      }).configured,
    ).toBe(false);

    const store = storeConfig({
      ...HOSTED,
      COMMERCE_APPLE_BUNDLE_ID: "app.countryflags.mobile.dev",
      COMMERCE_APPLE_ROOT_CERTIFICATES: CERTIFICATE,
    });
    expect(store.configured).toBe(true);
    expect(store.rootCertificates).toEqual([
      Buffer.from(CERTIFICATE, "base64"),
    ]);
  });

  it("needs the app's Apple id before it will believe a Production purchase", () => {
    const production = {
      ...HOSTED,
      DEPLOYMENT_ENV: "prod",
      COMMERCE_APPLE_BUNDLE_ID: "app.countryflags.mobile",
      COMMERCE_APPLE_ROOT_CERTIFICATES: CERTIFICATE,
    };

    expect(storeConfig(production).configured).toBe(false);
    expect(
      storeConfig({ ...production, COMMERCE_APPLE_APP_APPLE_ID: "6480000001" })
        .configured,
    ).toBe(true);
  });

  it("needs nothing but a bundle identifier to run the local test store", () => {
    const store = storeConfig(LOCAL);

    expect(store.configured).toBe(true);
    expect(store.bundleId).toBe("app.countryflags.mobile.local");
  });
});
