import "reflect-metadata";
import "dotenv/config";

import { ConfigService } from "@nestjs/config";

import {
  type EnvironmentVariables,
  validateEnvironment,
} from "../config/environment.validation";
import { TestProviderTokenSigner } from "../modules/auth/testing/test-provider-token-signer";

const RAW_NONCE = "TEST_ONLY_country_flags_nonce_000001";

async function run(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("TEST_ONLY provider tokens are disabled in production");
  }
  const provider = process.argv[2]?.toUpperCase();
  if (provider !== "APPLE" && provider !== "GOOGLE") {
    throw new Error("Usage: auth:provider-token:test <apple|google>");
  }
  const environment = validateEnvironment({
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ??
      "postgresql://country_flags:country_flags@localhost:5432/country_flags",
  });
  const signer = new TestProviderTokenSigner(
    new ConfigService<EnvironmentVariables>(environment),
  );
  const options = {
    // issuedAt must be the actual current time: reauthentication rejects any
    // provider token older than AUTH_REAUTH_TOKEN_TTL_SECONDS, so a fixed
    // historical date would make this "print a fresh token" tool never
    // actually produce a fresh one.
    issuedAt: new Date(),
    expiresAt: new Date("2100-01-01T00:00:00.000Z"),
    ...(provider === "APPLE" ? { rawNonce: RAW_NONCE } : {}),
  };
  const token =
    provider === "APPLE"
      ? await signer.signApple(options)
      : await signer.signGoogle(options);
  process.stdout.write(
    `${JSON.stringify({
      provider,
      token,
      ...(provider === "APPLE"
        ? {
            rawNonce: RAW_NONCE,
            authorizationCode: "TEST_ONLY_authorization_code",
          }
        : {}),
    })}\n`,
  );
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Test provider token creation failed: ${message}\n`);
  process.exitCode = 1;
});
