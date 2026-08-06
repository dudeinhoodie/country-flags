// Abuse test for the `auth:google` rate limit (10 requests / 60s per client IP,
// backend/src/modules/auth/auth.controller.ts). All k6 VUs run from the same host, so
// they naturally share one source IP against the target — that IS the scenario this
// limit exists to bound, not a limitation of the test.
//
// Run: k6 run -e BASE_URL=http://localhost:3000 backend/test/load/k6/auth-login.js
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const rateLimited = new Counter("rate_limited_responses");

export const options = {
  scenarios: {
    hammer_login: {
      executor: "constant-vus",
      vus: 5,
      duration: "20s",
    },
  },
  thresholds: {
    // The point of this script: confirm the limiter actually engages, not that it
    // never does — so we assert it DOES trip at least once, rather than staying green.
    rate_limited_responses: ["count>0"],
    http_req_failed: ["rate<0.01"], // "failed" = k6 network error, not 4xx/5xx status
  },
};

export default function () {
  const response = http.post(
    `${BASE_URL}/v1/auth/google`,
    JSON.stringify({
      idToken: "load-test-invalid-token-that-is-long-enough-to-pass-shape-checks",
      device: {
        platform: "IOS",
        model: "k6-load-test",
        osVersion: "1.0",
        appVersion: "1.0.0",
      },
    }),
    { headers: { "Content-Type": "application/json" } },
  );

  check(response, {
    "status is 401 or 429": (r) => r.status === 401 || r.status === 429,
    "never 5xx": (r) => r.status < 500,
  });

  if (response.status === 429) {
    rateLimited.add(1);
    check(response, {
      "429 carries Retry-After": (r) => r.headers["Retry-After"] !== undefined,
    });
  }

  sleep(0.1);
}
