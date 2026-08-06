import { bootstrapTelemetry, shutdownTelemetry } from "./telemetry.bootstrap";

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
});
