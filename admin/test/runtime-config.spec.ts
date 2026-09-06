import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadRuntimeConfig,
  parseRuntimeConfig,
  RuntimeConfigError,
} from "../src/config/runtime-config";

const validConfig = {
  environment: "dev",
  apiBasePath: "/api",
  googleClientId: "public-client-id",
  appVersion: "abc1234",
};

describe("parseRuntimeConfig", () => {
  it("accepts a complete config", () => {
    expect(parseRuntimeConfig(validConfig)).toEqual({
      ...validConfig,
      features: {},
    });
  });

  // A console served a config written before flags existed must start with
  // every flag off rather than refuse to start.
  it("treats a missing features block as no features", () => {
    expect(parseRuntimeConfig(validConfig).features).toEqual({});
  });

  it("reads the flags it knows and ignores the ones it does not", () => {
    const config = parseRuntimeConfig({
      ...validConfig,
      features: { advancedOverrides: true, somethingElse: true },
    });
    expect(config.features.advancedOverrides).toBe(true);
    expect(config.features).toEqual({ advancedOverrides: true });
  });

  it("refuses a flag that is not a boolean", () => {
    expect(() =>
      parseRuntimeConfig({
        ...validConfig,
        features: { advancedOverrides: "yes" },
      }),
    ).toThrow(RuntimeConfigError);
    expect(() => parseRuntimeConfig({ ...validConfig, features: [] })).toThrow(
      RuntimeConfigError,
    );
  });

  it("tolerates an empty googleClientId until sign-in lands", () => {
    const config = parseRuntimeConfig({ ...validConfig, googleClientId: "" });
    expect(config.googleClientId).toBe("");
  });

  it("rejects a non-object payload", () => {
    expect(() => parseRuntimeConfig("dev")).toThrow(RuntimeConfigError);
    expect(() => parseRuntimeConfig(null)).toThrow(RuntimeConfigError);
    expect(() => parseRuntimeConfig([validConfig])).toThrow(RuntimeConfigError);
  });

  it("rejects an unknown environment", () => {
    expect(() =>
      parseRuntimeConfig({ ...validConfig, environment: "staging" }),
    ).toThrow(RuntimeConfigError);
  });

  it("collects every problem instead of stopping at the first", () => {
    let caught: unknown;
    try {
      parseRuntimeConfig({ environment: "staging", apiBasePath: "api" });
    } catch (error) {
      caught = error;
    }
    if (!(caught instanceof RuntimeConfigError)) {
      throw new Error("expected a RuntimeConfigError");
    }
    expect(caught.problems).toHaveLength(4);
  });
});

describe("loadRuntimeConfig", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and parses /config.json", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(validConfig), { status: 200 }),
        ),
    );
    await expect(loadRuntimeConfig()).resolves.toEqual({
      ...validConfig,
      features: {},
    });
  });

  it("fails on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("missing", { status: 404 })),
    );
    await expect(loadRuntimeConfig()).rejects.toThrow("HTTP 404");
  });

  it("fails on a body that is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })),
    );
    await expect(loadRuntimeConfig()).rejects.toThrow("not valid JSON");
  });

  it("fails when the request itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("network down")),
    );
    await expect(loadRuntimeConfig()).rejects.toThrow("Failed to fetch");
  });
});
