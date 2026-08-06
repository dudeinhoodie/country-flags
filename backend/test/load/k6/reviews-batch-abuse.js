// Abuse test for the `reviews:batch` rate limit (30 requests / 60s per authenticated
// user, backend/src/modules/reviews/reviews.controller.ts).
//
// Requires a bearer token for an authenticated user. Generate one with:
//   yarn workspace @country-flags/backend study:token:test
// (prints a long-lived TEST_ONLY access token for the seeded TEST_STUDY_USER_ID — see
// backend/src/cli/print-test-access-token.ts).
//
// The batch payload below is shape-valid (passes parseReviewBatchRequest — see
// backend/src/modules/reviews/review-batch.request.ts) but references a random card ID,
// not a real seeded one. That's deliberate: this script proves the RATE LIMITER and the
// endpoint's concurrency behavior, not full review-ingestion business logic — expect
// 404/422 domain responses under the limit, not 200s, unless run against a DB seeded
// with a card matching CARD_ID.
//
// Run: k6 run -e BASE_URL=http://localhost:3000 -e ACCESS_TOKEN=<token> \
//   backend/test/load/k6/reviews-batch-abuse.js
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const ACCESS_TOKEN = __ENV.ACCESS_TOKEN;
const CARD_ID = __ENV.CARD_ID || "00000000-0000-4000-8000-000000000000";
const rateLimited = new Counter("rate_limited_responses");

if (!ACCESS_TOKEN) {
  throw new Error(
    "ACCESS_TOKEN is required — see the header comment for how to generate one",
  );
}

export const options = {
  scenarios: {
    hammer_reviews: {
      executor: "constant-vus",
      vus: 5,
      duration: "20s",
    },
  },
  thresholds: {
    rate_limited_responses: ["count>0"],
    http_req_failed: ["rate<0.01"],
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
        responseTimeMs: 1200,
        clientOccurredAt: now,
        estimatedServerOccurredAt: now,
        clientSequence: __VU * 1_000_000 + __ITER,
        baseStateVersion: null,
      },
    ],
  });

  const response = http.post(`${BASE_URL}/v1/reviews/batch`, body, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
  });

  check(response, { "never 5xx": (r) => r.status < 500 });

  if (response.status === 429) {
    rateLimited.add(1);
    check(response, {
      "429 carries Retry-After": (r) => r.headers["Retry-After"] !== undefined,
    });
  }

  sleep(0.1);
}
