import { validateEnvironment } from "./environment.validation";

describe("validateEnvironment", () => {
  const validConfig = {
    NODE_ENV: "test",
    PORT: "3001",
    LOG_LEVEL: "warn",
    DATABASE_URL: "postgresql://user:password@localhost:5432/country_flags",
  };
  const productionAuthConfig = {
    AUTH_PROVIDER_TEST_TOKENS_ENABLED: "false",
    AUTH_ACCESS_TOKEN_SECRET:
      "production-access-secret-with-at-least-32-characters",
    AUTH_ACCESS_TOKEN_ISSUER: "https://api.country-flags.example",
    AUTH_ACCESS_TOKEN_AUDIENCE: "country-flags-api",
    AUTH_RATE_LIMIT_SECRET:
      "production-rate-limit-secret-with-at-least-32-characters",
    APPLE_CLIENT_IDS: "com.countryflags.ios",
    GOOGLE_CLIENT_IDS: "web.apps.googleusercontent.com",
  };

  it("normalizes valid environment variables", () => {
    expect(validateEnvironment(validConfig)).toMatchObject({
      NODE_ENV: "test",
      PORT: 3001,
      LOG_LEVEL: "warn",
      DATABASE_URL: validConfig.DATABASE_URL,
      TEST_AUTH_ENABLED: true,
      AUTH_PROVIDER_TEST_TOKENS_ENABLED: true,
      AUTH_ACCESS_TOKEN_TTL_SECONDS: 900,
      AUTH_REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
      APPLE_CLIENT_IDS: ["com.countryflags.local"],
      GOOGLE_CLIENT_IDS: ["country-flags-local.apps.googleusercontent.com"],
    });
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
    ).toThrow("TEST_AUTH_ENABLED cannot be enabled in production");
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
      "AUTH_PROVIDER_TEST_TOKENS_ENABLED cannot be enabled in production",
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
});
