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

  it("keeps the API up when the collector configuration is unusable", () => {
    const stderr = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    try {
      // A URL the OTLP exporter cannot parse: telemetry is the thing that must
      // fail, and this runs before Nest boots, so a throw here would be an outage.
      expect(() =>
        bootstrapTelemetry({
          NODE_ENV: "production",
          DEPLOYMENT_ENV: "dev",
          SERVICE_RELEASE: "0e7c1a9",
          OTEL_ENABLED: "true",
          OTEL_EXPORTER_OTLP_ENDPOINT: "not-a-url",
        }),
      ).not.toThrow();
    } finally {
      stderr.mockRestore();
    }
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

    it("separates two rollouts of one release and names the schema they ran against", () => {
      expect(
        telemetryResourceAttributes({
          NODE_ENV: "production",
          DEPLOYMENT_ENV: "dev",
          SERVICE_RELEASE: "0e7c1a9",
          K_REVISION: "api-dev-00127-nmd",
          MIGRATION_VERSION: "20260901120000_add_entitlements",
        }),
      ).toMatchObject({
        "deployment.id": "api-dev-00127-nmd",
        "country_flags.migration.version": "20260901120000_add_entitlements",
      });
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
