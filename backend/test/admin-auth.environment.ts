// Imported by admin-auth.e2e-spec.ts BEFORE the application module:
// ConfigModule.forRoot validates process.env at import time of
// app.module.ts, so values set inside beforeAll arrive too late to reach
// the ConfigService snapshot.
export const originalAdminEnvironment = {
  ADMIN_EMAIL_ALLOWLIST: process.env.ADMIN_EMAIL_ALLOWLIST,
  ADMIN_ALLOWED_ORIGINS: process.env.ADMIN_ALLOWED_ORIGINS,
  AUTH_PROVIDER_TEST_TOKENS_ENABLED:
    process.env.AUTH_PROVIDER_TEST_TOKENS_ENABLED,
};

export const TRUSTED_ORIGIN = "http://admin.local.test";

process.env.ADMIN_EMAIL_ALLOWLIST = "editor@example.test,@country-flags.test";
process.env.ADMIN_ALLOWED_ORIGINS = TRUSTED_ORIGIN;
process.env.AUTH_PROVIDER_TEST_TOKENS_ENABLED = "true";
