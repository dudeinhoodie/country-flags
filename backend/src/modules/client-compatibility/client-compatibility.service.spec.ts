import { ConfigService } from "@nestjs/config";

import { JsonLoggerService } from "../../common/logging/json-logger.service";
import { MetricsService } from "../../common/telemetry/metrics.service";
import {
  type EnvironmentVariables,
  validateEnvironment,
} from "../../config/environment.validation";
import {
  ClientCompatibilityService,
  GATED_ROUTES,
  type ClientRequestContext,
} from "./client-compatibility.service";

const BASE = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:password@localhost:5432/country_flags",
};

interface Harness {
  service: ClientCompatibilityService;
  recordClientVersionGate: jest.SpyInstance;
  warn: jest.SpyInstance;
}

function harness(minimums?: string): Harness {
  const metrics = new MetricsService();
  const logger = new JsonLoggerService();
  const recordClientVersionGate = jest
    .spyOn(metrics, "recordClientVersionGate")
    .mockImplementation(() => undefined);
  const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
  const service = new ClientCompatibilityService(
    new ConfigService<EnvironmentVariables, true>(
      validateEnvironment({
        ...BASE,
        ...(minimums === undefined
          ? {}
          : { PAID_CONTENT_MINIMUM_CLIENT_VERSIONS: minimums }),
      }),
    ),
    metrics,
    logger,
  );
  return { service, recordClientVersionGate, warn };
}

function request(
  overrides: Partial<ClientRequestContext> = {},
): ClientRequestContext {
  return {
    route: GATED_ROUTES.deckCatalog,
    platform: "ios",
    appVersion: "1.4.0",
    ...overrides,
  };
}

describe("ClientCompatibilityService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("admits the release named as the minimum and everything after it", () => {
    const { service } = harness("ios=1.4.0");

    for (const appVersion of ["1.4.0", "1.4.1", "1.5.0", "2.0.0"]) {
      expect(service.capabilityOf(request({ appVersion }))).toEqual({
        paidContent: true,
      });
    }
  });

  it("refuses a build older than the minimum", () => {
    const { service } = harness("ios=1.4.0");

    for (const appVersion of ["1.3.9", "1.0.0", "0.1.0"]) {
      expect(service.capabilityOf(request({ appVersion }))).toEqual({
        paidContent: false,
      });
    }
  });

  it("treats a caller that says nothing as the oldest build there is", () => {
    // A request with no version is either a build old enough to predate the
    // header or something that is not the app at all, and both want the
    // catalog the free app has always seen.
    const { service } = harness("ios=1.4.0");

    for (const context of [
      request({ appVersion: undefined }),
      request({ appVersion: "" }),
      request({ appVersion: "   " }),
      request({ appVersion: "latest" }),
      request({ platform: undefined }),
      request({ platform: "" }),
      request({ platform: "smartfridge" }),
    ]) {
      expect(service.capabilityOf(context).paidContent).toBe(false);
    }
  });

  it("reads the platform the way a header arrives, not the way it is typed", () => {
    const { service } = harness("ios=1.4.0");

    expect(
      service.capabilityOf(request({ platform: " iOS " })).paidContent,
    ).toBe(true);
  });

  it("admits nobody until a minimum is configured for the platform", () => {
    // Which is the literal truth before the StoreKit client ships, and the
    // reason the default is this way round: forgetting to configure the gate
    // hides paid decks from everybody, while the opposite default hands a
    // locked deck to an app that has no idea it is locked.
    const unconfigured = harness();
    const otherPlatform = harness("android=1.0.0");

    expect(unconfigured.service.capabilityOf(request()).paidContent).toBe(
      false,
    );
    expect(otherPlatform.service.capabilityOf(request()).paidContent).toBe(
      false,
    );
    expect(
      otherPlatform.service.capabilityOf(
        request({ platform: "android", appVersion: "1.0.0" }),
      ).paidContent,
    ).toBe(true);
  });

  it("counts every request it looked at, by route and by what it decided", () => {
    const { service, recordClientVersionGate } = harness("ios=1.4.0");

    service.capabilityOf(request());
    service.capabilityOf(
      request({ route: GATED_ROUTES.contentChanges, appVersion: "1.0.0" }),
    );
    service.capabilityOf(request({ route: GATED_ROUTES.deck, platform: "tv" }));
    service.capabilityOf(request({ appVersion: "banana" }));
    service.capabilityOf(request({ appVersion: undefined }));

    expect(recordClientVersionGate.mock.calls).toEqual([
      ["GET /v1/decks", "paid_content_aware"],
      ["GET /v1/content/changes", "below_minimum"],
      ["GET /v1/decks/{deckId}", "platform_unknown"],
      ["GET /v1/decks", "version_unreadable"],
      ["GET /v1/decks", "version_missing"],
    ]);
  });

  it("counts a deployment with no minimum without labelling it a fault", () => {
    const { service, recordClientVersionGate, warn } = harness();

    service.capabilityOf(request());

    expect(recordClientVersionGate).toHaveBeenCalledWith(
      "GET /v1/decks",
      "no_minimum_configured",
    );
    // Every deployment looks like this until the StoreKit client ships, so a
    // log line here would warn about the absence of a problem forever.
    expect(warn).not.toHaveBeenCalled();
  });

  it("writes one line for a route and outcome, and says what it stood for", () => {
    const { service, warn } = harness("ios=1.4.0");
    const started = Date.parse("2026-09-06T10:00:00.000Z");
    jest.spyOn(Date, "now").mockReturnValue(started);

    for (let index = 0; index < 5; index += 1) {
      service.capabilityOf(request({ appVersion: "1.0.0" }));
    }

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({
      message: "Client build cannot be shown paid decks",
      event: "client_version_gate",
      route: "GET /v1/decks",
      outcome: "below_minimum",
      clientPlatform: "ios",
      clientAppVersion: "1.0.0",
      minimumClientVersions: { ios: "1.4.0" },
      suppressedSinceLastEntry: 0,
    });

    // A minute later the next one is written, and it carries the four it
    // stood in for.
    jest.spyOn(Date, "now").mockReturnValue(started + 60_001);
    service.capabilityOf(request({ appVersion: "1.0.0" }));

    expect(warn).toHaveBeenLastCalledWith(
      expect.objectContaining({ suppressedSinceLastEntry: 4 }),
    );
  });

  it("does not let one route's line stand in for another's", () => {
    const { service, warn } = harness("ios=1.4.0");
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-06T10:00:00Z"));

    service.capabilityOf(request({ appVersion: "1.0.0" }));
    service.capabilityOf(
      request({ route: GATED_ROUTES.contentChanges, appVersion: "1.0.0" }),
    );
    service.capabilityOf(request({ appVersion: undefined }));

    expect(warn).toHaveBeenCalledTimes(3);
  });
});
