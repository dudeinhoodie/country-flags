-- Sign in with Apple tokens are kept so that deleting the account can revoke
-- them (issue #444, docs/01 §5.1 and §5.5, App Store guideline 5.1.1(v)).
--
-- The refresh token Apple returns for the sign-in's authorization code is
-- stored AES-256-GCM encrypted, never in plaintext, next to the client id it
-- was issued to: revocation has to name the same client. The state records
-- what the last exchange came to, so a deletion can say why there was no
-- token to revoke. A failed exchange keeps an earlier token, which is still
-- valid, so the state and the token are deliberately independent.

CREATE TYPE "public"."ProviderTokenState" AS ENUM ('STORED', 'CREDENTIALS_NOT_CONFIGURED', 'EXCHANGE_FAILED');

ALTER TABLE "public"."auth_identities"
  ADD COLUMN "provider_token_ciphertext" TEXT,
  ADD COLUMN "provider_token_client_id" TEXT,
  ADD COLUMN "provider_token_state" "public"."ProviderTokenState",
  ADD COLUMN "provider_token_updated_at" TIMESTAMPTZ(3);

ALTER TABLE "public"."auth_identities"
  ADD CONSTRAINT "auth_identities_provider_token_apple_only_check"
    CHECK (
      "provider" = 'APPLE'
      OR (
        "provider_token_ciphertext" IS NULL
        AND "provider_token_client_id" IS NULL
        AND "provider_token_state" IS NULL
        AND "provider_token_updated_at" IS NULL
      )
    ),
  ADD CONSTRAINT "auth_identities_provider_token_client_check"
    CHECK (
      ("provider_token_ciphertext" IS NULL) = ("provider_token_client_id" IS NULL)
    ),
  ADD CONSTRAINT "auth_identities_provider_token_stored_check"
    CHECK (
      "provider_token_state" IS DISTINCT FROM 'STORED'
      OR "provider_token_ciphertext" IS NOT NULL
    ),
  ADD CONSTRAINT "auth_identities_provider_token_format_check"
    CHECK (
      "provider_token_ciphertext" IS NULL
      OR "provider_token_ciphertext" ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    );
