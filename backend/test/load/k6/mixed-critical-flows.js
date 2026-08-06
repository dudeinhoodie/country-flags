// Broader concurrency smoke test: ramps virtual users through a mix of read (sync
// changes) and write (review batch) traffic against the same account, alongside
// unauthenticated health polling. Looks for connection-pool exhaustion, N+1-under-load
// latency blowups, or any 5xx leaking through — not a substitute for real capacity
// planning (no staging environment exists in this repo to run this against).
//
// Requires ACCESS_TOKEN — see reviews-batch-abuse.js for how to generate one.
//
// Run: k6 run -e BASE_URL=http://localhost:3000 -e ACCESS_TOKEN=<token> \
//   backend/test/load/k6/mixed-critical-flows.js
import http from "k6/http";
import { check, sleep, group } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const ACCESS_TOKEN = __ENV.ACCESS_TOKEN;
const CARD_ID = __ENV.CARD_ID || "00000000-0000-4000-8000-000000000000";

if (!ACCESS_TOKEN) {
  throw new Error(
    "ACCESS_TOKEN is required — see reviews-batch-abuse.js for how to generate one",
  );
}

const authHeaders = {
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ACCESS_TOKEN}`,
  },
};

export const options = {
  scenarios: {
    ramping_mixed_traffic: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 20 },
        { duration: "30s", target: 20 },
        { duration: "10s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"], // k6 network-level failures only
    "http_req_duration{endpoint:health}": ["p(95)<200"],
    "http_req_duration{endpoint:sync_changes}": ["p(95)<1000"],
  },
};

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function () {
  group("health poll (unauthenticated)", () => {
    const response = http.get(`${BASE_URL}/v1/health/live`, {
      tags: { endpoint: "health" },
    });
    check(response, { "200 OK": (r) => r.status === 200 });
  });

  group("sync changes (read)", () => {
    const response = http.get(`${BASE_URL}/v1/me/changes?limit=20`, {
      ...authHeaders,
      tags: { endpoint: "sync_changes" },
    });
    check(response, {
      "200 or 429": (r) => r.status === 200 || r.status === 429,
      "never 5xx": (r) => r.status < 500,
    });
  });

  group("review batch (write)", () => {
    const now = new Date().toISOString();
    const body = JSON.stringify({
      payloadVersion: 1,
      events: [
        {
          id: uuidv4(),
          sessionId: uuidv4(),
          learningCardId: CARD_ID,
          deviceId: uuidv4(),
          answerMode: "SELF_RATED",
          rating: "GOOD",
          responseTimeMs: 900,
          clientOccurredAt: now,
          estimatedServerOccurredAt: now,
          clientSequence: __VU * 1_000_000 + __ITER,
          baseStateVersion: null,
        },
      ],
    });
    const response = http.post(`${BASE_URL}/v1/reviews/batch`, body, {
      ...authHeaders,
      tags: { endpoint: "reviews_batch" },
    });
    check(response, { "never 5xx": (r) => r.status < 500 });
  });

  sleep(0.2);
}
