import {
  bootstrapTelemetry,
  shutdownTelemetry,
  telemetryResourceAttributes,
} from "./telemetry.bootstrap";

describe("telemetry bootstrap", () => {
  afterEach(async () => {
    // Reset the module-level SDK handle so tests don't leak state into each other.
    await shutdownTelemetry();
  });

  it("is a genuine no-op when OTEL_ENABLED is unset", () => {
    expect(() => bootstrapTelemetry({})).not.toThrow();
  });

  it("is a no-op when OTEL_ENABLED is explicitly false", () => {
    expect(() => bootstrapTelemetry({ OTEL_ENABLED: "false" })).not.toThrow();
  });

  it("is a no-op when OTEL_ENABLED is true but no endpoint is configured", () => {
    expect(() =>
      bootstrapTelemetry({
        OTEL_ENABLED: "true",
        OTEL_EXPORTER_OTLP_ENDPOINT: "",
      }),
    ).not.toThrow();
  });

  it("shuts down cleanly when nothing was ever started", async () => {
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });

  describe("resource attributes", () => {
    it("distinguishes two hosted deployments of the same release build", () => {
      const shared = {
        NODE_ENV: "production",
        SERVICE_NAME: "country-flags-api",
        SERVICE_RELEASE: "0e7c1a9",
      };

      expect(
        telemetryResourceAttributes({ ...shared, DEPLOYMENT_ENV: "dev" }),
      ).toEqual({
        "service.name": "country-flags-api",
        "service.version": "0e7c1a9",
        "deployment.environment.name": "dev",
      });
      expect(
        telemetryResourceAttributes({ ...shared, DEPLOYMENT_ENV: "prod" }),
      ).toMatchObject({ "deployment.environment.name": "prod" });
    });

    it("falls back to the local defaults", () => {
      expect(telemetryResourceAttributes({ NODE_ENV: "development" })).toEqual({
        "service.name": "country-flags-api",
        "service.version": "dev",
        "deployment.environment.name": "local",
      });
    });
  });
});
