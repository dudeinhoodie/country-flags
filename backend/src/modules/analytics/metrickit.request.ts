import { UnprocessableEntityException } from "@nestjs/common";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_PAYLOAD_BASE64_LENGTH = 349_528;

export interface MetricKitReportRequest {
  reportId: string;
  payloadVersion: 1;
  appVersion: string;
  build: string;
  generatedAt: string;
  encoding: "gzip_base64";
  sha256: string;
  payload: string;
}

function fail(message: string): never {
  throw new UnprocessableEntityException(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseMetricKitReport(body: unknown): MetricKitReportRequest {
  if (!isRecord(body)) {
    fail("MetricKit report must be an object");
  }
  const {
    reportId,
    payloadVersion,
    appVersion,
    build,
    generatedAt,
    encoding,
    sha256,
    payload,
    ...rest
  } = body;
  if (Object.keys(rest).length > 0) {
    fail(
      `MetricKit report has unrecognized fields: ${Object.keys(rest).join(", ")}`,
    );
  }
  if (typeof reportId !== "string" || !UUID_PATTERN.test(reportId)) {
    fail("reportId must be a UUID");
  }
  if (payloadVersion !== 1) {
    fail("payloadVersion must be 1");
  }
  if (typeof appVersion !== "string" || !APP_VERSION_PATTERN.test(appVersion)) {
    fail("appVersion must be a semantic version");
  }
  if (typeof build !== "string" || build.length < 1 || build.length > 32) {
    fail("build must be 1-32 characters");
  }
  if (
    typeof generatedAt !== "string" ||
    Number.isNaN(Date.parse(generatedAt))
  ) {
    fail("generatedAt must be a valid date-time");
  }
  if (encoding !== "gzip_base64") {
    fail("encoding must be gzip_base64");
  }
  if (typeof sha256 !== "string" || !SHA256_PATTERN.test(sha256)) {
    fail("sha256 must be a lowercase hex digest");
  }
  if (
    typeof payload !== "string" ||
    payload.length < 1 ||
    payload.length > MAX_PAYLOAD_BASE64_LENGTH
  ) {
    fail("payload must be a non-empty base64 string within the size limit");
  }

  return {
    reportId,
    payloadVersion: 1,
    appVersion,
    build,
    generatedAt,
    encoding: "gzip_base64",
    sha256,
    payload,
  };
}
