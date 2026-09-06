import { validateEnvironment } from "./environment.validation";

describe("validateEnvironment", () => {
  const validConfig = {
    NODE_ENV: "test",
    PORT: "3001",
    LOG_LEVEL: "warn",
    DATABASE_URL: "postgresql://user:password@localhost:5432/country_flags",
  };
  // A hosted deployment: NODE_ENV=production plus everything dev/prod additionally require.
  const productionAuthConfig = {
    DEPLOYMENT_ENV: "prod",
    DIRECT_DATABASE_URL:
      "postgresql://user:password@direct.localhost:5432/country_flags",
    SERVICE_RELEASE: "0e7c1a9",
    AUTH_PROVIDER_TEST_TOKENS_ENABLED: "false",
    AUTH_ACCESS_TOKEN_SECRET:
      "production-access-secret-with-at-least-32-characters",
    AUTH_ACCESS_TOKEN_ISSUER: "https://api.country-flags.example",
    AUTH_ACCESS_TOKEN_AUDIENCE: "country-flags-api",
    AUTH_RATE_LIMIT_SECRET:
      "production-rate-limit-secret-with-at-least-32-characters",
    ACCOUNT_DATA_HASH_SECRET:
      "production-account-data-secret-with-at-least-32-characters",
    PUBLIC_BASE_URL: "https://api.country-flags.example",
    APPLE_CLIENT_IDS: "com.countryflags.ios",
    GOOGLE_CLIENT_IDS: "web.apps.googleusercontent.com",
  };

  it("normalizes valid environment variables", () => {
    expect(validateEnvironment(validConfig)).toMatchObject({
      NODE_ENV: "test",
      DEPLOYMENT_ENV: "ci",
      PORT: 3001,
      LOG_LEVEL: "warn",
      DATABASE_URL: validConfig.DATABASE_URL,
      DIRECT_DATABASE_URL: validConfig.DATABASE_URL,
      SERVICE_NAME: "country-flags-api",
      SERVICE_RELEASE: "dev",
      TEST_AUTH_ENABLED: true,
      AUTH_PROVIDER_TEST_TOKENS_ENABLED: true,
      AUTH_ACCESS_TOKEN_TTL_SECONDS: 900,
      AUTH_REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
      AUTH_REAUTH_TOKEN_TTL_SECONDS: 300,
      DATA_EXPORT_DOWNLOAD_TTL_SECONDS: 300,
      PUBLIC_BASE_URL: "http://localhost:3000",
      APPLE_CLIENT_IDS: ["com.countryflags.local"],
      GOOGLE_CLIENT_IDS: ["country-flags-local.apps.googleusercontent.com"],
      CORS_ALLOWED_ORIGINS: ["http://localhost:5173"],
      SHUTDOWN_DRAIN_MS: 5_000,
    });
  });

  it("rejects a SHUTDOWN_DRAIN_MS outside the allowed range", () => {
    expect(() =>
      validateEnvironment({
        ...validConfig,
        SHUTDOWN_DRAIN_MS: "60000",
      }),
    ).toThrow("SHUTDOWN_DRAIN_MS must be an integer");
  });

  it("defaults CORS_ALLOWED_ORIGINS to an empty allowlist in production", () => {
    expect(
      validateEnvironment({
        ...validConfig,
        NODE_ENV: "production",
        ...productionAuthConfig,
      }),
    ).toMatchObject({ CORS_ALLOWED_ORIGINS: [] });
  });

  it("rejects a wildcard CORS origin", () => {
    expect(() =>
      validateEnvironment({
        ...validConfig,
        CORS_ALLOWED_ORIGINS: "*",
      }),
    ).toThrow("CORS_ALLOWED_ORIGINS must not contain a wildcard");
  });

  it("rejects a missing database URL", () => {
    expect(() =>
      validateEnvironment({
        ...validConfig,
        DATABASE_URL: "",
      }),
    ).toThrow("DATABASE_URL is required");
  });

  it("fails fast when production misses a required variable", () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: "production",
        PORT: "3000",
        LOG_LEVEL: "info",
        ...productionAuthConfig,
      }),
    ).toThrow("DATABASE_URL is required");
  });

  it("prevents the test auth guard from being enabled in production", () => {
    expect(() =>
      validateEnvironment({
        ...validConfig,
        NODE_ENV: "production",
        ...productionAuthConfig,
        TEST_AUTH_ENABLED: "true",
      }),
    ).toThrow(
      "TEST_AUTH_ENABLED cannot be enabled with NODE_ENV=production and DEPLOYMENT_ENV=prod",
    );
  });

  it("disables test auth by default in production", () => {
    expect(
      validateEnvironment({
        ...validConfig,
        NODE_ENV: "production",
        ...productionAuthConfig,
      }),
    ).toMatchObject({
      TEST_AUTH_ENABLED: false,
      AUTH_PROVIDER_TEST_TOKENS_ENABLED: false,
    });
  });

  it("requires production auth configuration", () => {
    expect(() =>
      validateEnvironment({
        ...validConfig,
        NODE_ENV: "production",
        DEPLOYMENT_ENV: "prod",
      }),
    ).toThrow("APPLE_CLIENT_IDS is required");
  });

  it("prevents local provider signing keys in production", () => {
    expect(() =>
      validateEnvironment({
        ...validConfig,
        ...productionAuthConfig,
        NODE_ENV: "production",
        AUTH_PROVIDER_TEST_TOKENS_ENABLED: "true",
      }),
    ).toThrow(
      "AUTH_PROVIDER_TEST_TOKENS_ENABLED cannot be enabled with NODE_ENV=production and DEPLOYMENT_ENV=prod",
    );
  });

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() =>
      validateEnvironment({
        ...validConfig,
        DATABASE_URL: "mysql://localhost/country_flags",
      }),
    ).toThrow("DATABASE_URL must use PostgreSQL");
  });

  it("rejects an invalid port", () => {
    expect(() =>
      validateEnvironment({
        ...validConfig,
        PORT: "70000",
      }),
    ).toThrow("PORT must be an integer");
  });

  describe("deployment environment contract", () => {
    it("rejects an unknown deployment environment", () => {
      expect(() =>
        validateEnvironment({
          ...validConfig,
          DEPLOYMENT_ENV: "staging",
        }),
      ).toThrow("DEPLOYMENT_ENV must be one of: local, ci, dev, prod");
    });

    it("defaults to local for a development runtime", () => {
      expect(
        validateEnvironment({ ...validConfig, NODE_ENV: "development" }),
      ).toMatchObject({ DEPLOYMENT_ENV: "local" });
    });

    it("requires an explicit deployment environment for a production runtime", () => {
      expect(() =>
        validateEnvironment({
          ...validConfig,
          ...productionAuthConfig,
          NODE_ENV: "production",
          DEPLOYMENT_ENV: "",
        }),
      ).toThrow("DEPLOYMENT_ENV is required when NODE_ENV is production");
    });

    it.each(["dev", "prod"])(
      "accepts the production build in the %s environment",
      (deploymentEnvironment) => {
        expect(
          validateEnvironment({
            ...validConfig,
            ...productionAuthConfig,
            NODE_ENV: "production",
            DEPLOYMENT_ENV: deploymentEnvironment,
          }),
        ).toMatchObject({
          NODE_ENV: "production",
          DEPLOYMENT_ENV: deploymentEnvironment,
          TEST_AUTH_ENABLED: false,
          AUTH_PROVIDER_TEST_TOKENS_ENABLED: false,
        });
      },
    );

    it.each(["development", "test"])(
      "refuses to run a hosted environment with NODE_ENV=%s",
      (nodeEnvironment) => {
        expect(() =>
          validateEnvironment({
            ...validConfig,
            ...productionAuthConfig,
            NODE_ENV: nodeEnvironment,
            DEPLOYMENT_ENV: "dev",
          }),
        ).toThrow("Deployment environment dev requires NODE_ENV=production");
      },
    );

    it.each(["dev", "prod"])(
      "cannot enable test auth in the %s environment",
      (deploymentEnvironment) => {
        expect(() =>
          validateEnvironment({
            ...validConfig,
            ...productionAuthConfig,
            NODE_ENV: "production",
            DEPLOYMENT_ENV: deploymentEnvironment,
            TEST_AUTH_ENABLED: "true",
          }),
        ).toThrow("TEST_AUTH_ENABLED cannot be enabled");
      },
    );

    it("keeps test auth available for a local runtime", () => {
      expect(
        validateEnvironment({
          ...validConfig,
          NODE_ENV: "development",
          DEPLOYMENT_ENV: "local",
        }),
      ).toMatchObject({
        TEST_AUTH_ENABLED: true,
        AUTH_PROVIDER_TEST_TOKENS_ENABLED: true,
      });
    });

    it("keeps test auth off for a production build run locally", () => {
      expect(() =>
        validateEnvironment({
          ...validConfig,
          ...productionAuthConfig,
          NODE_ENV: "production",
          DEPLOYMENT_ENV: "local",
          TEST_AUTH_ENABLED: "true",
        }),
      ).toThrow(
        "TEST_AUTH_ENABLED cannot be enabled with NODE_ENV=production and DEPLOYMENT_ENV=local",
      );
    });
  });

  describe("database URLs", () => {
    it("requires a direct migration URL in a hosted environment", () => {
      const hostedWithoutDirectUrl: Record<string, unknown> = {
        ...productionAuthConfig,
      };
      delete hostedWithoutDirectUrl.DIRECT_DATABASE_URL;

      expect(() =>
        validateEnvironment({
          ...validConfig,
          ...hostedWithoutDirectUrl,
          NODE_ENV: "production",
        }),
      ).toThrow("DIRECT_DATABASE_URL is required");
    });

    it("keeps the runtime and migration URLs separate when both are given", () => {
      expect(
        validateEnvironment({
          ...validConfig,
          ...productionAuthConfig,
          NODE_ENV: "production",
        }),
      ).toMatchObject({
        DATABASE_URL: validConfig.DATABASE_URL,
        DIRECT_DATABASE_URL: productionAuthConfig.DIRECT_DATABASE_URL,
      });
    });

    it("validates the migration URL as PostgreSQL", () => {
      expect(() =>
        validateEnvironment({
          ...validConfig,
          DIRECT_DATABASE_URL: "mysql://localhost/country_flags",
        }),
      ).toThrow("DIRECT_DATABASE_URL must use PostgreSQL");
    });
  });

  describe("release metadata", () => {
    it("requires a real release identifier in a hosted environment", () => {
      expect(() =>
        validateEnvironment({
          ...validConfig,
          ...productionAuthConfig,
          NODE_ENV: "production",
          SERVICE_RELEASE: "dev",
        }),
      ).toThrow("SERVICE_RELEASE must identify the deployed release");
    });

    it("requires the release identifier to be present in a hosted environment", () => {
      const hostedWithoutRelease: Record<string, unknown> = {
        ...productionAuthConfig,
      };
      delete hostedWithoutRelease.SERVICE_RELEASE;

      expect(() =>
        validateEnvironment({
          ...validConfig,
          ...hostedWithoutRelease,
          NODE_ENV: "production",
        }),
      ).toThrow("SERVICE_RELEASE is required");
    });
  });

  describe("admin GitHub credential", () => {
    it("rejects a partial configuration instead of degrading silently", () => {
      expect(() =>
        validateEnvironment({
          ...validConfig,
          ADMIN_GITHUB_TOKEN: "github_pat_example",
        }),
      ).toThrow(
        "ADMIN_GITHUB_TOKEN, ADMIN_GITHUB_OWNER, ADMIN_GITHUB_REPOSITORY must be set together",
      );
    });

    it("accepts the credential when all three variables are present", () => {
      expect(() =>
        validateEnvironment({
          ...validConfig,
          ADMIN_GITHUB_TOKEN: "github_pat_example",
          ADMIN_GITHUB_OWNER: "dudeinhoodie",
          ADMIN_GITHUB_REPOSITORY: "country-flags",
        }),
      ).not.toThrow();
    });

    it("accepts the credential being absent entirely", () => {
      expect(() => validateEnvironment(validConfig)).not.toThrow();
    });
  });

  describe("Apple store environment", () => {
    // Bytes that begin like DER: an ASN.1 SEQUENCE, which is all the
    // configuration check looks at.
    const certificate = Buffer.from([0x30, 0x82, 0x01, 0x02]).toString(
      "base64",
    );
    const devConfig = {
      ...validConfig,
      ...productionAuthConfig,
      NODE_ENV: "production",
      DEPLOYMENT_ENV: "dev",
    };

    it("gives a hosted deployment the store its environment names", () => {
      expect(
        validateEnvironment({
          ...validConfig,
          ...productionAuthConfig,
          NODE_ENV: "production",
        }).COMMERCE_APPLE_STORE_ENVIRONMENT,
      ).toBe("PRODUCTION");
      expect(
        validateEnvironment(devConfig).COMMERCE_APPLE_STORE_ENVIRONMENT,
      ).toBe("SANDBOX");
      expect(
        validateEnvironment(validConfig).COMMERCE_APPLE_STORE_ENVIRONMENT,
      ).toBe("LOCAL_TEST");
    });

    it("refuses to let production accept a Sandbox purchase", () => {
      expect(() =>
        validateEnvironment({
          ...validConfig,
          ...productionAuthConfig,
          NODE_ENV: "production",
          COMMERCE_APPLE_STORE_ENVIRONMENT: "SANDBOX",
        }),
      ).toThrow("accepts only PRODUCTION store transactions");
    });

    it("refuses to let dev accept a Production purchase", () => {
      expect(() =>
        validateEnvironment({
          ...devConfig,
          COMMERCE_APPLE_STORE_ENVIRONMENT: "PRODUCTION",
        }),
      ).toThrow("accepts only SANDBOX store transactions");
    });

    it("keeps the unsigned local test store out of every hosted deployment", () => {
      // LOCAL_TEST skips signature verification entirely, so a deployment
      // that could select it could be handed a purchase anybody wrote.
      expect(() =>
        validateEnvironment({
          ...devConfig,
          COMMERCE_APPLE_STORE_ENVIRONMENT: "LOCAL_TEST",
        }),
      ).toThrow("accepts only SANDBOX store transactions");
      expect(() =>
        validateEnvironment({
          ...validConfig,
          ...productionAuthConfig,
          NODE_ENV: "production",
          COMMERCE_APPLE_STORE_ENVIRONMENT: "LOCAL_TEST",
        }),
      ).toThrow("accepts only PRODUCTION store transactions");
    });

    it("lets a local run reach Sandbox but never Production", () => {
      expect(
        validateEnvironment({
          ...validConfig,
          COMMERCE_APPLE_STORE_ENVIRONMENT: "sandbox",
        }).COMMERCE_APPLE_STORE_ENVIRONMENT,
      ).toBe("SANDBOX");
      expect(() =>
        validateEnvironment({
          ...validConfig,
          COMMERCE_APPLE_STORE_ENVIRONMENT: "PRODUCTION",
        }),
      ).toThrow("must not verify PRODUCTION store transactions");
    });

    it("rejects an unknown store environment", () => {
      expect(() =>
        validateEnvironment({
          ...validConfig,
          COMMERCE_APPLE_STORE_ENVIRONMENT: "TESTFLIGHT",
        }),
      ).toThrow("COMMERCE_APPLE_STORE_ENVIRONMENT must be one of");
    });

    it("leaves a deployment without an app record unconfigured rather than dead", () => {
      // The tables, the guard and the endpoints ship before App Store
      // Connect has anything to point at; a missing bundle identifier is a
      // state, not a startup failure.
      const environment = validateEnvironment(devConfig);
      expect(environment.COMMERCE_APPLE_BUNDLE_ID).toBe("");
      expect(environment.COMMERCE_APPLE_APP_APPLE_ID).toBeNull();
      expect(environment.COMMERCE_APPLE_ROOT_CERTIFICATES).toEqual([]);
    });

    it("accepts base64 DER root certificates and refuses anything else", () => {
      expect(
        validateEnvironment({
          ...devConfig,
          COMMERCE_APPLE_BUNDLE_ID: "app.countryflags.mobile.dev",
          COMMERCE_APPLE_ROOT_CERTIFICATES: `${certificate},${certificate}`,
        }).COMMERCE_APPLE_ROOT_CERTIFICATES,
      ).toEqual([certificate]);
      expect(() =>
        validateEnvironment({
          ...devConfig,
          COMMERCE_APPLE_ROOT_CERTIFICATES: "-----BEGIN CERTIFICATE-----\nMIIB",
        }),
      ).toThrow("must contain base64-encoded DER certificates");
    });
  });

  describe("App Store Server API credential", () => {
    const credential = {
      COMMERCE_APPLE_IAP_KEY_ID: "2X9R4HXF34",
      COMMERCE_APPLE_IAP_ISSUER_ID: "57246542-96fe-1a63-e053-0824d011072a",
      COMMERCE_APPLE_IAP_PRIVATE_KEY: "TEST_ONLY_base64_pkcs8_placeholder",
    };

    it("rejects a partial configuration instead of degrading silently", () => {
      expect(() =>
        validateEnvironment({
          ...validConfig,
          COMMERCE_APPLE_IAP_KEY_ID: credential.COMMERCE_APPLE_IAP_KEY_ID,
        }),
      ).toThrow(
        "COMMERCE_APPLE_IAP_KEY_ID, COMMERCE_APPLE_IAP_ISSUER_ID, COMMERCE_APPLE_IAP_PRIVATE_KEY must be set together",
      );
    });

    it("carries the key from configuration and nowhere else", () => {
      // It arrives from Secret Manager as an environment variable and is
      // read here only; there is no path by which it reaches the repository.
      expect(
        validateEnvironment({ ...validConfig, ...credential }),
      ).toMatchObject(credential);
    });

    it("accepts the credential being absent entirely", () => {
      expect(
        validateEnvironment(validConfig).COMMERCE_APPLE_IAP_PRIVATE_KEY,
      ).toBe("");
    });
  });
  describe("the minimum client version paid decks are shown to", () => {
    const key = "PAID_CONTENT_MINIMUM_CLIENT_VERSIONS";

    it("reads one platform per entry, in the canonical three-number form", () => {
      expect(
        validateEnvironment({
          ...validConfig,
          [key]: " ios=1.4 , android=2.0.0 ",
        })[key],
      ).toEqual({ ios: "1.4.0", android: "2.0.0" });
    });

    it("names no platform at all until a build understands paid decks", () => {
      // Which is the truth before the StoreKit client ships, and it makes the
      // gate closed by default: forgetting to configure it hides paid decks
      // from everybody, rather than handing a locked deck to an app with no
      // idea it is locked.
      expect(validateEnvironment(validConfig)[key]).toEqual({});
      expect(validateEnvironment({ ...validConfig, [key]: "" })[key]).toEqual(
        {},
      );
    });

    it("stops the process rather than quietly disabling itself", () => {
      // A typo would otherwise read as "nothing configured", which is also
      // what a correct deployment looks like the day before a release.
      expect(() =>
        validateEnvironment({ ...validConfig, [key]: "ios=1.4.0.1" }),
      ).toThrow("must give ios a version like 1.4.0");
      expect(() =>
        validateEnvironment({ ...validConfig, [key]: "iphone=1.4.0" }),
      ).toThrow("must contain platform=version entries");
      expect(() =>
        validateEnvironment({ ...validConfig, [key]: "1.4.0" }),
      ).toThrow("must contain platform=version entries");
      expect(() =>
        validateEnvironment({ ...validConfig, [key]: "ios=1.4.0,ios=1.5.0" }),
      ).toThrow("names platform ios more than once");
    });
  });
});
