import { generateKeyPairSync, randomBytes } from "node:crypto";

/**
 * A complete, throwaway Sign in with Apple configuration for tests that
 * validate a prod environment, which refuses to start without one. The key
 * is generated per call and never leaves the process.
 */
export function testSignInWithAppleConfig(): Record<string, string> {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    AUTH_APPLE_TEAM_ID: "TESTTEAM01",
    AUTH_APPLE_KEY_ID: "TESTKEY001",
    AUTH_APPLE_PRIVATE_KEY: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    AUTH_PROVIDER_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  };
}
