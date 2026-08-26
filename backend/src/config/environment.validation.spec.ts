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
});
