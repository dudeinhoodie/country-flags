import { UnprocessableEntityException } from "@nestjs/common";

import { parseMetricKitReport } from "./metrickit.request";

function validReport(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    reportId: "11111111-1111-4111-8111-111111111111",
    payloadVersion: 1,
    appVersion: "1.0.0",
    build: "100",
    generatedAt: "2026-08-06T00:00:00.000Z",
    encoding: "gzip_base64",
    sha256: "a".repeat(64),
    payload: "c29tZS1wYXlsb2Fk",
    ...overrides,
  };
}

describe("parseMetricKitReport", () => {
  it("accepts a well-formed report", () => {
    expect(parseMetricKitReport(validReport())).toEqual(validReport());
  });

  it.each([
    ["reportId", "not-a-uuid"],
    ["payloadVersion", 2],
    ["appVersion", "1.0"],
    ["build", ""],
    ["generatedAt", "not-a-date"],
    ["encoding", "raw"],
    ["sha256", "not-hex"],
    ["payload", ""],
  ])("rejects an invalid %s", (field, value) => {
    expect(() => parseMetricKitReport(validReport({ [field]: value }))).toThrow(
      UnprocessableEntityException,
    );
  });

  it("rejects unrecognized fields", () => {
    expect(() => parseMetricKitReport(validReport({ extra: "field" }))).toThrow(
      UnprocessableEntityException,
    );
  });
});
