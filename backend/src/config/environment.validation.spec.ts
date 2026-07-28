import { validateEnvironment } from "./environment.validation";

describe("validateEnvironment", () => {
  const validConfig = {
    NODE_ENV: "test",
    PORT: "3001",
    LOG_LEVEL: "warn",
    DATABASE_URL: "postgresql://user:password@localhost:5432/country_flags",
  };

  it("normalizes valid environment variables", () => {
    expect(validateEnvironment(validConfig)).toMatchObject({
      NODE_ENV: "test",
      PORT: 3001,
      LOG_LEVEL: "warn",
      DATABASE_URL: validConfig.DATABASE_URL,
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
      }),
    ).toThrow("DATABASE_URL is required");
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
