import "reflect-metadata";

import { TestJwtSigner } from "../modules/auth/testing/test-jwt-signer";
import { TEST_STUDY_USER_ID } from "../modules/study-sessions/fixtures/test-study.fixture";

function run(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("TEST_ONLY access tokens are disabled in production");
  }

  const token = new TestJwtSigner().sign(TEST_STUDY_USER_ID, {
    issuedAt: new Date("2026-07-29T00:00:00.000Z"),
    expiresAt: new Date("2100-01-01T00:00:00.000Z"),
  });
  process.stdout.write(`${token}\n`);
}

try {
  run();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Test token creation failed: ${message}\n`);
  process.exitCode = 1;
}
