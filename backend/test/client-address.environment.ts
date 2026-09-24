// Imported by client-address.e2e-spec.ts BEFORE the application module:
// ConfigModule.forRoot validates process.env at import time of
// app.module.ts, so values set inside beforeAll arrive too late to reach
// the ConfigService snapshot.
export const originalClientAddressEnvironment = {
  TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS,
  ADMIN_TRUST_PROXY_HOPS: process.env.ADMIN_TRUST_PROXY_HOPS,
  ADMIN_EMAIL_ALLOWLIST: process.env.ADMIN_EMAIL_ALLOWLIST,
  ADMIN_ALLOWED_ORIGINS: process.env.ADMIN_ALLOWED_ORIGINS,
  AUTH_PROVIDER_TEST_TOKENS_ENABLED:
    process.env.AUTH_PROVIDER_TEST_TOKENS_ENABLED,
};

export const TRUSTED_ORIGIN = "http://admin.local.test";

// The hosted topology: one front end before the API, and the console's nginx
// plus its own front end before a console request.
process.env.TRUST_PROXY_HOPS = "1";
process.env.ADMIN_TRUST_PROXY_HOPS = "2";
process.env.ADMIN_EMAIL_ALLOWLIST = "@country-flags.test";
process.env.ADMIN_ALLOWED_ORIGINS = TRUSTED_ORIGIN;
process.env.AUTH_PROVIDER_TEST_TOKENS_ENABLED = "true";
