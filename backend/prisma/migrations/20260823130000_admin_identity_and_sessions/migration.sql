-- Admin console identity, deliberately separate from the consumer tables:
-- administrators are never consumer accounts, an allowlisted Google identity
-- is the only way in, and disabling one must not touch product data
-- (docs/adr/ADR-014-admin-console-architecture.md).

CREATE TYPE "public"."AdminRole" AS ENUM ('VIEWER', 'EDITOR', 'PUBLISHER', 'ADMIN');

CREATE TYPE "public"."AdminUserStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "public"."admin_users" (
  "id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "role" "public"."AdminRole" NOT NULL DEFAULT 'VIEWER',
  "status" "public"."AdminUserStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_users_email_key" ON "public"."admin_users"("email");

CREATE TABLE "public"."admin_identities" (
  "id" UUID NOT NULL,
  "admin_user_id" UUID NOT NULL,
  "provider" "public"."AuthProvider" NOT NULL,
  "provider_subject" TEXT NOT NULL,
  "email" TEXT,
  "email_verified" BOOLEAN,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_login_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_identities_provider_provider_subject_key"
  ON "public"."admin_identities"("provider", "provider_subject");

CREATE UNIQUE INDEX "admin_identities_admin_user_id_provider_key"
  ON "public"."admin_identities"("admin_user_id", "provider");

CREATE INDEX "admin_identities_admin_user_id_idx"
  ON "public"."admin_identities"("admin_user_id");

-- Sessions are opaque server-side records; the browser only ever holds the
-- random token whose SHA-256 lives in token_hash. Idle and absolute deadlines
-- are separate columns so the guard can slide the former and never the latter.
CREATE TABLE "public"."admin_sessions" (
  "id" UUID NOT NULL,
  "admin_user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "ip_hash" TEXT,
  "user_agent" TEXT,

  CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_sessions_token_hash_key"
  ON "public"."admin_sessions"("token_hash");

CREATE INDEX "admin_sessions_admin_user_id_absolute_expires_at_idx"
  ON "public"."admin_sessions"("admin_user_id", "absolute_expires_at");

ALTER TABLE "public"."admin_identities"
  ADD CONSTRAINT "admin_identities_admin_user_id_fkey"
  FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."admin_sessions"
  ADD CONSTRAINT "admin_sessions_admin_user_id_fkey"
  FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
