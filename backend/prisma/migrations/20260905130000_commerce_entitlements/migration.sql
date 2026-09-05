-- Paid decks as entitlements rather than as products (ADR-019).
--
-- An Apple product sells an offer, an offer grants entitlement keys, and a
-- key opens whichever decks require it. Nothing here stores a price: the
-- store owns what a thing costs, and price takes no part in deciding what
-- somebody may open.
--
-- The unique keys are the point of this migration rather than a detail of
-- it. A purchase is delivered more than once — by the app, by a server
-- notification, by the repair job — and it is these constraints, not the
-- code above them, that make the second delivery change nothing.

CREATE TYPE "public"."DeckAccessModel" AS ENUM ('FREE', 'ENTITLEMENT');

CREATE TYPE "public"."EntitlementStatus" AS ENUM ('ACTIVE', 'RETIRED');

CREATE TYPE "public"."CommerceOfferKind" AS ENUM ('ONE_TIME');

CREATE TYPE "public"."CommerceOfferStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

CREATE TYPE "public"."StoreProvider" AS ENUM ('APPLE_APP_STORE', 'GOOGLE_PLAY', 'WEB');

CREATE TYPE "public"."StoreEnvironment" AS ENUM ('LOCAL_TEST', 'SANDBOX', 'PRODUCTION');

CREATE TYPE "public"."StoreProductType" AS ENUM ('NON_CONSUMABLE');

CREATE TYPE "public"."StoreProductStatus" AS ENUM ('DRAFT', 'VALIDATED', 'ACTIVE', 'RETIRED', 'INVALID');

CREATE TYPE "public"."StoreOwnershipType" AS ENUM ('PURCHASED', 'FAMILY_SHARED', 'UNKNOWN');

CREATE TYPE "public"."StoreTransactionClaimState" AS ENUM ('CLAIMED', 'RELEASED_BY_ACCOUNT_DELETION', 'CONFLICT', 'QUARANTINED');

CREATE TYPE "public"."EntitlementGrantSource" AS ENUM ('STORE_TRANSACTION', 'SUPPORT_OVERRIDE', 'MIGRATION');

CREATE TYPE "public"."EntitlementGrantStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TYPE "public"."StoreNotificationStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'QUARANTINED');

-- The token a purchase is made under. Existing accounts get one now rather
-- than on their next purchase, so a restore never has to invent one.
ALTER TABLE "public"."users"
  ADD COLUMN "store_account_token" UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX "users_store_account_token_key" ON "public"."users" ("store_account_token");

CREATE TABLE "public"."entitlement_definitions" (
  "key" TEXT NOT NULL,
  "status" "public"."EntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
  "description" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "entitlement_definitions_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "public"."commerce_offers" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "kind" "public"."CommerceOfferKind" NOT NULL DEFAULT 'ONE_TIME',
  "status" "public"."CommerceOfferStatus" NOT NULL DEFAULT 'DRAFT',
  "sort_order" INTEGER,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "commerce_offers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "commerce_offers_code_key" ON "public"."commerce_offers" ("code");

CREATE INDEX "commerce_offers_status_idx" ON "public"."commerce_offers" ("status");

CREATE TABLE "public"."commerce_offer_localizations" (
  "offer_id" UUID NOT NULL,
  "locale" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,

  CONSTRAINT "commerce_offer_localizations_pkey" PRIMARY KEY ("offer_id", "locale")
);

CREATE TABLE "public"."commerce_offer_grants" (
  "offer_id" UUID NOT NULL,
  "entitlement_key" TEXT NOT NULL,

  CONSTRAINT "commerce_offer_grants_pkey" PRIMARY KEY ("offer_id", "entitlement_key")
);

CREATE INDEX "commerce_offer_grants_entitlement_key_idx" ON "public"."commerce_offer_grants" ("entitlement_key");

CREATE TABLE "public"."store_products" (
  "id" UUID NOT NULL,
  "offer_id" UUID NOT NULL,
  "provider" "public"."StoreProvider" NOT NULL,
  "store_environment" "public"."StoreEnvironment" NOT NULL,
  "bundle_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "product_type" "public"."StoreProductType" NOT NULL DEFAULT 'NON_CONSUMABLE',
  "status" "public"."StoreProductStatus" NOT NULL DEFAULT 'DRAFT',
  "store_status" TEXT,
  "last_validated_at" TIMESTAMPTZ(3),
  "validation_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "store_products_pkey" PRIMARY KEY ("id")
);

-- The same product id in Sandbox and in Production are two different things.
CREATE UNIQUE INDEX "store_products_store_identity_unique"
  ON "public"."store_products" ("provider", "store_environment", "bundle_id", "product_id");

CREATE INDEX "store_products_offer_id_idx" ON "public"."store_products" ("offer_id");

CREATE TABLE "public"."store_transactions" (
  "id" UUID NOT NULL,
  "provider" "public"."StoreProvider" NOT NULL,
  "store_environment" "public"."StoreEnvironment" NOT NULL,
  "transaction_id" TEXT NOT NULL,
  "original_transaction_id" TEXT,
  "product_id" TEXT NOT NULL,
  "store_account_token" UUID,
  "user_id" UUID,
  "ownership_type" "public"."StoreOwnershipType" NOT NULL DEFAULT 'PURCHASED',
  "purchased_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "revocation_reason" TEXT,
  "signed_payload_hash" CHAR(64) NOT NULL,
  "verified_at" TIMESTAMPTZ(3) NOT NULL,
  "claim_state" "public"."StoreTransactionClaimState" NOT NULL DEFAULT 'CLAIMED',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "store_transactions_pkey" PRIMARY KEY ("id")
);

-- Delivering the same purchase twice must write one row, whichever path it
-- arrived by.
CREATE UNIQUE INDEX "store_transactions_identity_unique"
  ON "public"."store_transactions" ("provider", "store_environment", "transaction_id");

CREATE INDEX "store_transactions_user_id_idx" ON "public"."store_transactions" ("user_id");

CREATE INDEX "store_transactions_original_transaction_id_idx" ON "public"."store_transactions" ("original_transaction_id");

CREATE TABLE "public"."user_entitlement_grants" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "entitlement_key" TEXT NOT NULL,
  "source_type" "public"."EntitlementGrantSource" NOT NULL,
  "source_transaction_id" UUID,
  "status" "public"."EntitlementGrantStatus" NOT NULL DEFAULT 'ACTIVE',
  "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(3),
  "revocation_reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "user_entitlement_grants_pkey" PRIMARY KEY ("id")
);

-- NULLS NOT DISTINCT because a migration or support grant has no
-- transaction behind it, and Postgres would otherwise let the same one be
-- issued again and again.
CREATE UNIQUE INDEX "user_entitlement_grants_source_unique"
  ON "public"."user_entitlement_grants" ("user_id", "entitlement_key", "source_type", "source_transaction_id")
  NULLS NOT DISTINCT;

CREATE INDEX "user_entitlement_grants_user_id_status_idx" ON "public"."user_entitlement_grants" ("user_id", "status");

CREATE INDEX "user_entitlement_grants_entitlement_key_status_idx" ON "public"."user_entitlement_grants" ("entitlement_key", "status");

CREATE TABLE "public"."store_notifications" (
  "id" UUID NOT NULL,
  "provider" "public"."StoreProvider" NOT NULL,
  "store_environment" "public"."StoreEnvironment" NOT NULL,
  "notification_uuid" TEXT NOT NULL,
  "notification_type" TEXT NOT NULL,
  "subtype" TEXT,
  "signed_date" TIMESTAMPTZ(3),
  "payload_hash" CHAR(64) NOT NULL,
  "status" "public"."StoreNotificationStatus" NOT NULL DEFAULT 'RECEIVED',
  "error" TEXT,
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(3),

  CONSTRAINT "store_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_notifications_notification_uuid_key" ON "public"."store_notifications" ("notification_uuid");

CREATE INDEX "store_notifications_status_received_at_idx" ON "public"."store_notifications" ("status", "received_at");

CREATE TABLE "public"."store_reconciliation_state" (
  "provider" "public"."StoreProvider" NOT NULL,
  "store_environment" "public"."StoreEnvironment" NOT NULL,
  "scope_key" TEXT NOT NULL,
  "last_revision" TEXT,
  "last_succeeded_at" TIMESTAMPTZ(3),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "store_reconciliation_state_pkey" PRIMARY KEY ("provider", "store_environment", "scope_key")
);

-- Access policy on the deck, and only there.
ALTER TABLE "public"."decks"
  ADD COLUMN "access_model" "public"."DeckAccessModel" NOT NULL DEFAULT 'FREE',
  ADD COLUMN "required_entitlement_key" TEXT;

-- A free deck naming an entitlement, or a paid one naming none, is not a
-- state the rest of the system has an answer for.
ALTER TABLE "public"."decks"
  ADD CONSTRAINT "decks_access_model_entitlement_check"
  CHECK (
    ("access_model" = 'FREE' AND "required_entitlement_key" IS NULL)
    OR ("access_model" = 'ENTITLEMENT' AND "required_entitlement_key" IS NOT NULL)
  );

CREATE INDEX "decks_required_entitlement_key_idx" ON "public"."decks" ("required_entitlement_key");

ALTER TABLE "public"."decks"
  ADD CONSTRAINT "decks_required_entitlement_key_fkey"
  FOREIGN KEY ("required_entitlement_key") REFERENCES "public"."entitlement_definitions" ("key")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."commerce_offer_localizations"
  ADD CONSTRAINT "commerce_offer_localizations_offer_id_fkey"
  FOREIGN KEY ("offer_id") REFERENCES "public"."commerce_offers" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."commerce_offer_grants"
  ADD CONSTRAINT "commerce_offer_grants_offer_id_fkey"
  FOREIGN KEY ("offer_id") REFERENCES "public"."commerce_offers" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."commerce_offer_grants"
  ADD CONSTRAINT "commerce_offer_grants_entitlement_key_fkey"
  FOREIGN KEY ("entitlement_key") REFERENCES "public"."entitlement_definitions" ("key")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."store_products"
  ADD CONSTRAINT "store_products_offer_id_fkey"
  FOREIGN KEY ("offer_id") REFERENCES "public"."commerce_offers" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."store_transactions"
  ADD CONSTRAINT "store_transactions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."user_entitlement_grants"
  ADD CONSTRAINT "user_entitlement_grants_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."user_entitlement_grants"
  ADD CONSTRAINT "user_entitlement_grants_entitlement_key_fkey"
  FOREIGN KEY ("entitlement_key") REFERENCES "public"."entitlement_definitions" ("key")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."user_entitlement_grants"
  ADD CONSTRAINT "user_entitlement_grants_source_transaction_id_fkey"
  FOREIGN KEY ("source_transaction_id") REFERENCES "public"."store_transactions" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
