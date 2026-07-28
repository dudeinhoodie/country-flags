-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('ACTIVE', 'DELETION_PENDING', 'DELETED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "public"."AuthProvider" AS ENUM ('APPLE', 'GOOGLE');

-- CreateEnum
CREATE TYPE "public"."ClientPlatform" AS ENUM ('IOS', 'ANDROID', 'WEB');

-- CreateEnum
CREATE TYPE "public"."AnswerMode" AS ENUM ('SELF_RATED', 'MULTIPLE_CHOICE', 'TEXT');

-- CreateEnum
CREATE TYPE "public"."ConsentStatus" AS ENUM ('UNKNOWN', 'GRANTED', 'DENIED', 'NOT_REQUIRED');

-- CreateEnum
CREATE TYPE "public"."ConsentCategory" AS ENUM ('PRODUCT_ANALYTICS', 'DIAGNOSTICS');

-- CreateEnum
CREATE TYPE "public"."ConsentSource" AS ENUM ('IOS', 'ANDROID', 'WEB', 'SUPPORT');

-- CreateEnum
CREATE TYPE "public"."GuestImportStatus" AS ENUM ('PENDING', 'APPLIED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."DataExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."ContentReleaseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "public"."ContentChangeOperation" AS ENUM ('UPSERT', 'RETIRE');

-- CreateEnum
CREATE TYPE "public"."ContentResourceType" AS ENUM ('ENTITY', 'DECK', 'LEARNING_CARD', 'ASSET', 'FACT');

-- CreateEnum
CREATE TYPE "public"."GeoEntityKind" AS ENUM ('COUNTRY', 'TERRITORY', 'DEPENDENCY', 'DISPUTED_AREA', 'REGION', 'SUBREGION', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."GeoEntityStatus" AS ENUM ('ACTIVE', 'HISTORICAL', 'HIDDEN');

-- CreateEnum
CREATE TYPE "public"."RecognitionStatus" AS ENUM ('UN_MEMBER', 'UN_OBSERVER', 'PARTIALLY_RECOGNIZED', 'UNRECOGNIZED', 'DEPENDENT_TERRITORY', 'SPECIAL_AREA', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "public"."GeoNameType" AS ENUM ('SHORT', 'OFFICIAL', 'COMMON', 'ALTERNATIVE');

-- CreateEnum
CREATE TYPE "public"."GeoRelationType" AS ENUM ('CONTAINS', 'ASSOCIATED_WITH');

-- CreateEnum
CREATE TYPE "public"."FactType" AS ENUM ('POPULATION', 'CAPITAL', 'AREA', 'LANGUAGE', 'CURRENCY', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."PublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "public"."CurrencyUsageType" AS ENUM ('PRIMARY', 'SECONDARY', 'DE_FACTO');

-- CreateEnum
CREATE TYPE "public"."AssetType" AS ENUM ('FLAG', 'COAT_OF_ARMS', 'MAP', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."AssetStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "public"."GradingMode" AS ENUM ('SELF_RATED', 'MULTIPLE_CHOICE', 'TEXT');

-- CreateEnum
CREATE TYPE "public"."CardStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "public"."RevisionChangeClassification" AS ENUM ('TECHNICAL', 'EQUIVALENT');

-- CreateEnum
CREATE TYPE "public"."ProgressPolicy" AS ENUM ('PRESERVE');

-- CreateEnum
CREATE TYPE "public"."DeckKind" AS ENUM ('CURATED', 'TAXONOMY', 'DYNAMIC_USER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "public"."DeckStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "public"."SelectionOrigin" AS ENUM ('SERVER', 'CLIENT_OFFLINE');

-- CreateEnum
CREATE TYPE "public"."StudySessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "public"."SelectionReason" AS ENUM ('OVERDUE', 'LEARNING', 'ERROR', 'NEW', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "public"."ReviewRating" AS ENUM ('AGAIN', 'HARD', 'GOOD', 'EASY');

-- CreateEnum
CREATE TYPE "public"."TimeConfidence" AS ENUM ('CALIBRATED', 'BOUNDED', 'RECEIVED_AT_FALLBACK');

-- CreateEnum
CREATE TYPE "public"."CardLearningState" AS ENUM ('NEW', 'LEARNING', 'REVIEW', 'RELEARNING');

-- CreateEnum
CREATE TYPE "public"."SchedulerAlgorithm" AS ENUM ('FSRS');

-- CreateEnum
CREATE TYPE "public"."SchedulerDefinitionStatus" AS ENUM ('DRAFT', 'CANARY', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "public"."AchievementScopeType" AS ENUM ('GLOBAL', 'DECK', 'REGION');

-- CreateEnum
CREATE TYPE "public"."MasteryTier" AS ENUM ('NONE', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM');

-- CreateEnum
CREATE TYPE "public"."OutboxDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."IdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL,
    "display_name" TEXT,
    "preferred_locale" TEXT NOT NULL DEFAULT 'ru',
    "status" "public"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deletion_requested_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."auth_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "public"."AuthProvider" NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "email" TEXT,
    "email_verified" BOOLEAN,
    "is_private_email" BOOLEAN,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_generated_id" TEXT NOT NULL,
    "platform" "public"."ClientPlatform" NOT NULL,
    "app_version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "last_client_time_sample" TIMESTAMPTZ(3),
    "last_server_time_sample" TIMESTAMPTZ(3),
    "estimated_clock_offset_ms" INTEGER,
    "push_token_encrypted" TEXT,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."refresh_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "token_hash" TEXT NOT NULL,
    "token_family_id" UUID NOT NULL,
    "rotated_from_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_settings" (
    "user_id" UUID NOT NULL,
    "session_size" SMALLINT NOT NULL DEFAULT 10,
    "content_locale" TEXT NOT NULL DEFAULT 'ru',
    "default_answer_mode" "public"."AnswerMode" NOT NULL DEFAULT 'SELF_RATED',
    "extra_fact_types" "public"."FactType"[] DEFAULT ARRAY[]::"public"."FactType"[],
    "sound_enabled" BOOLEAN NOT NULL DEFAULT true,
    "haptics_enabled" BOOLEAN NOT NULL DEFAULT true,
    "reminders_enabled" BOOLEAN NOT NULL DEFAULT false,
    "reminder_local_time" TIME(0),
    "reminder_weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "desired_retention" DECIMAL(4,3) NOT NULL DEFAULT 0.900,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "public"."user_privacy_settings" (
    "user_id" UUID NOT NULL,
    "product_analytics_status" "public"."ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "diagnostics_status" "public"."ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "policy_version" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_privacy_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "public"."privacy_consent_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" "public"."ConsentCategory" NOT NULL,
    "previous_status" "public"."ConsentStatus" NOT NULL,
    "new_status" "public"."ConsentStatus" NOT NULL,
    "policy_version" TEXT NOT NULL,
    "source" "public"."ConsentSource" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "privacy_consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."guest_import_operations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source_install_id_hash" TEXT NOT NULL,
    "status" "public"."GuestImportStatus" NOT NULL DEFAULT 'PENDING',
    "accepted_event_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_event_count" INTEGER NOT NULL DEFAULT 0,
    "rejected_event_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "guest_import_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."data_export_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "public"."DataExportStatus" NOT NULL DEFAULT 'PENDING',
    "object_key" TEXT,
    "sha256" CHAR(64),
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "data_export_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."content_releases" (
    "version" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "status" "public"."ContentReleaseStatus" NOT NULL DEFAULT 'DRAFT',
    "manifest_checksum" CHAR(64) NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "retired_at" TIMESTAMPTZ(3),

    CONSTRAINT "content_releases_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "public"."content_pointers" (
    "key" TEXT NOT NULL,
    "content_version" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "content_pointers_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."content_changes" (
    "sequence" BIGSERIAL NOT NULL,
    "content_version" TEXT NOT NULL,
    "operation" "public"."ContentChangeOperation" NOT NULL,
    "resource_type" "public"."ContentResourceType" NOT NULL,
    "resource_id" UUID NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_changes_pkey" PRIMARY KEY ("sequence")
);

-- CreateTable
CREATE TABLE "public"."geo_entities" (
    "id" UUID NOT NULL,
    "content_key" TEXT NOT NULL,
    "kind" "public"."GeoEntityKind" NOT NULL,
    "slug" TEXT NOT NULL,
    "iso_alpha2" CHAR(2),
    "iso_alpha3" CHAR(3),
    "m49_code" CHAR(3),
    "custom_code" TEXT,
    "status" "public"."GeoEntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "include_in_country_catalog" BOOLEAN NOT NULL DEFAULT false,
    "recognition_status" "public"."RecognitionStatus",
    "recognition_as_of" DATE,
    "recognition_note" JSONB,
    "valid_from" DATE,
    "valid_to" DATE,
    "metadata" JSONB NOT NULL,
    "content_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "geo_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."geo_entity_names" (
    "id" UUID NOT NULL,
    "geo_entity_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "name_type" "public"."GeoNameType" NOT NULL,
    "value" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "source_id" UUID,

    CONSTRAINT "geo_entity_names_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."geo_relations" (
    "id" UUID NOT NULL,
    "parent_entity_id" UUID NOT NULL,
    "child_entity_id" UUID NOT NULL,
    "taxonomy_code" TEXT NOT NULL,
    "relation_type" "public"."GeoRelationType" NOT NULL,
    "valid_from" DATE,
    "valid_to" DATE,
    "sort_order" INTEGER,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "geo_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sources" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "license_name" TEXT,
    "license_url" TEXT,
    "retrieved_at" TIMESTAMPTZ(3) NOT NULL,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."facts" (
    "id" UUID NOT NULL,
    "geo_entity_id" UUID NOT NULL,
    "fact_type" "public"."FactType" NOT NULL,
    "value" JSONB NOT NULL,
    "unit" TEXT,
    "observed_at" DATE,
    "effective_from" DATE,
    "effective_to" DATE,
    "source_id" UUID NOT NULL,
    "status" "public"."PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "content_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."currencies" (
    "id" UUID NOT NULL,
    "code" CHAR(3) NOT NULL,
    "numeric_code" CHAR(3),
    "decimals" SMALLINT,
    "symbol" TEXT,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."currency_names" (
    "currency_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "currency_names_pkey" PRIMARY KEY ("currency_id","locale")
);

-- CreateTable
CREATE TABLE "public"."geo_entity_currencies" (
    "id" UUID NOT NULL,
    "geo_entity_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "usage_type" "public"."CurrencyUsageType" NOT NULL,
    "valid_from" DATE,
    "valid_to" DATE,
    "source_id" UUID NOT NULL,

    CONSTRAINT "geo_entity_currencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."assets" (
    "id" UUID NOT NULL,
    "geo_entity_id" UUID,
    "asset_type" "public"."AssetType" NOT NULL,
    "variant" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "public_url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "aspect_ratio" DECIMAL(12,6),
    "source_id" UUID NOT NULL,
    "license_name" TEXT NOT NULL,
    "license_url" TEXT,
    "attribution" TEXT,
    "valid_from" DATE,
    "valid_to" DATE,
    "status" "public"."AssetStatus" NOT NULL DEFAULT 'DRAFT',
    "content_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."card_templates" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "prompt_type" TEXT NOT NULL,
    "answer_type" TEXT NOT NULL,
    "grading_mode" "public"."GradingMode" NOT NULL,
    "prompt_spec" JSONB NOT NULL,
    "answer_spec" JSONB NOT NULL,
    "back_side_fact_types" "public"."FactType"[] DEFAULT ARRAY[]::"public"."FactType"[],
    "status" "public"."PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "card_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."learning_cards" (
    "id" UUID NOT NULL,
    "subject_entity_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "semantic_version" INTEGER NOT NULL,
    "supersedes_learning_card_id" UUID,
    "status" "public"."CardStatus" NOT NULL DEFAULT 'ACTIVE',
    "difficulty_hint" DECIMAL(8,4),
    "content_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "learning_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."learning_card_revisions" (
    "id" UUID NOT NULL,
    "learning_card_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "prompt_asset_id" UUID,
    "prompt_fingerprint" TEXT NOT NULL,
    "change_classification" "public"."RevisionChangeClassification" NOT NULL,
    "progress_policy" "public"."ProgressPolicy" NOT NULL DEFAULT 'PRESERVE',
    "content_version" TEXT NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "retired_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "learning_card_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."decks" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "public"."DeckKind" NOT NULL,
    "owner_user_id" UUID,
    "rule_spec" JSONB,
    "status" "public"."DeckStatus" NOT NULL DEFAULT 'DRAFT',
    "content_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "decks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."deck_localizations" (
    "deck_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "deck_localizations_pkey" PRIMARY KEY ("deck_id","locale")
);

-- CreateTable
CREATE TABLE "public"."deck_cards" (
    "deck_id" UUID NOT NULL,
    "learning_card_id" UUID NOT NULL,
    "sort_order" INTEGER,
    "membership_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "deck_cards_pkey" PRIMARY KEY ("deck_id","learning_card_id")
);

-- CreateTable
CREATE TABLE "public"."study_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "deck_id" UUID NOT NULL,
    "mode" "public"."AnswerMode" NOT NULL,
    "selection_origin" "public"."SelectionOrigin" NOT NULL,
    "requested_unique_count" SMALLINT NOT NULL,
    "selected_unique_count" SMALLINT NOT NULL,
    "status" "public"."StudySessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "content_version" TEXT NOT NULL,
    "scheduler_version" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "summary" JSONB,

    CONSTRAINT "study_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."study_session_cards" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "learning_card_id" UUID NOT NULL,
    "learning_card_revision_id" UUID NOT NULL,
    "initial_order" SMALLINT NOT NULL,
    "selection_reason" "public"."SelectionReason" NOT NULL,
    "state_version_at_selection" INTEGER,
    "distractor_policy_version" TEXT,
    "random_seed" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "study_session_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."study_session_card_options" (
    "id" UUID NOT NULL,
    "study_session_card_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "answer_entity_id" UUID NOT NULL,
    "display_snapshot" JSONB NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_session_card_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."review_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "learning_card_id" UUID NOT NULL,
    "session_id" UUID,
    "device_id" UUID,
    "rating" "public"."ReviewRating" NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "answer_mode" "public"."AnswerMode" NOT NULL,
    "selected_option_id" UUID,
    "response_time_ms" INTEGER,
    "client_occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "estimated_server_occurred_at" TIMESTAMPTZ(3),
    "effective_occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "client_sequence" BIGINT NOT NULL,
    "time_confidence" "public"."TimeConfidence" NOT NULL,
    "base_state_version" INTEGER,
    "scheduler_version" TEXT NOT NULL,
    "scheduler_parameters_version" TEXT NOT NULL,
    "payload_version" INTEGER NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "review_events_pkey" PRIMARY KEY ("user_id","id")
);

-- CreateTable
CREATE TABLE "public"."user_card_states" (
    "user_id" UUID NOT NULL,
    "learning_card_id" UUID NOT NULL,
    "state" "public"."CardLearningState" NOT NULL DEFAULT 'NEW',
    "difficulty" DECIMAL(12,6) NOT NULL,
    "stability" DECIMAL(14,6) NOT NULL,
    "retrievability_at_review" DECIMAL(8,6),
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "last_reviewed_at" TIMESTAMPTZ(3),
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "scheduler_version" TEXT NOT NULL,
    "scheduler_parameters_version" TEXT NOT NULL,
    "state_version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_card_states_pkey" PRIMARY KEY ("user_id","learning_card_id")
);

-- CreateTable
CREATE TABLE "public"."scheduler_definitions" (
    "version" TEXT NOT NULL,
    "algorithm" "public"."SchedulerAlgorithm" NOT NULL,
    "algorithm_major" INTEGER NOT NULL,
    "package_name" TEXT NOT NULL,
    "package_version" TEXT NOT NULL,
    "parameters_version" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "default_desired_retention" DECIMAL(4,3) NOT NULL,
    "status" "public"."SchedulerDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
    "active_from" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduler_definitions_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "public"."scheduler_migration_checkpoints" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "learning_card_id" UUID NOT NULL,
    "from_scheduler_version" TEXT NOT NULL,
    "to_scheduler_version" TEXT NOT NULL,
    "cutoff_effective_occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "cutoff_event_id" UUID NOT NULL,
    "migrated_state" JSONB NOT NULL,
    "state_checksum" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduler_migration_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."achievement_definitions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tier" "public"."MasteryTier",
    "rule_version" INTEGER NOT NULL,
    "rule_spec" JSONB NOT NULL,
    "active_from" TIMESTAMPTZ(3) NOT NULL,
    "active_to" TIMESTAMPTZ(3),

    CONSTRAINT "achievement_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."achievement_localizations" (
    "definition_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "achievement_localizations_pkey" PRIMARY KEY ("definition_id","locale")
);

-- CreateTable
CREATE TABLE "public"."user_achievements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "scope_type" "public"."AchievementScopeType" NOT NULL,
    "scope_id" UUID,
    "earned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rule_version" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL,

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_deck_mastery" (
    "user_id" UUID NOT NULL,
    "deck_id" UUID NOT NULL,
    "tier" "public"."MasteryTier" NOT NULL DEFAULT 'NONE',
    "mastered_card_count" INTEGER NOT NULL DEFAULT 0,
    "total_card_count" INTEGER NOT NULL DEFAULT 0,
    "projection_version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_deck_mastery_pkey" PRIMARY KEY ("user_id","deck_id")
);

-- CreateTable
CREATE TABLE "public"."idempotency_records" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" "public"."IdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
    "response_status" INTEGER,
    "response_body" JSONB,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."analytics_outbox" (
    "event_id" UUID NOT NULL,
    "event_name" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "analytics_subject_id" TEXT,
    "anonymous_id" TEXT,
    "properties" JSONB NOT NULL,
    "context" JSONB NOT NULL,
    "consent_category" "public"."ConsentCategory" NOT NULL,
    "delivery_status" "public"."OutboxDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "analytics_outbox_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "public"."audit_events" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "request_id" UUID,
    "metadata" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_status_deletion_requested_at_idx" ON "public"."users"("status", "deletion_requested_at");

-- CreateIndex
CREATE INDEX "auth_identities_user_id_idx" ON "public"."auth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_provider_provider_subject_key" ON "public"."auth_identities"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_user_id_provider_key" ON "public"."auth_identities"("user_id", "provider");

-- CreateIndex
CREATE INDEX "devices_user_id_last_seen_at_idx" ON "public"."devices"("user_id", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "devices_user_id_client_generated_id_key" ON "public"."devices"("user_id", "client_generated_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "public"."refresh_sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_rotated_from_id_key" ON "public"."refresh_sessions"("rotated_from_id");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_token_family_id_idx" ON "public"."refresh_sessions"("user_id", "token_family_id");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_expires_at_idx" ON "public"."refresh_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "privacy_consent_events_user_id_occurred_at_idx" ON "public"."privacy_consent_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "guest_import_operations_user_id_created_at_idx" ON "public"."guest_import_operations"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "guest_import_operations_user_id_source_install_id_hash_id_key" ON "public"."guest_import_operations"("user_id", "source_install_id_hash", "id");

-- CreateIndex
CREATE INDEX "data_export_requests_user_id_created_at_idx" ON "public"."data_export_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "data_export_requests_status_expires_at_idx" ON "public"."data_export_requests"("status", "expires_at");

-- CreateIndex
CREATE INDEX "content_releases_status_published_at_idx" ON "public"."content_releases"("status", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "content_pointers_content_version_key" ON "public"."content_pointers"("content_version");

-- CreateIndex
CREATE INDEX "content_changes_content_version_sequence_idx" ON "public"."content_changes"("content_version", "sequence");

-- CreateIndex
CREATE INDEX "content_changes_resource_type_resource_id_idx" ON "public"."content_changes"("resource_type", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "geo_entities_content_key_key" ON "public"."geo_entities"("content_key");

-- CreateIndex
CREATE UNIQUE INDEX "geo_entities_slug_key" ON "public"."geo_entities"("slug");

-- CreateIndex
CREATE INDEX "geo_entities_kind_status_idx" ON "public"."geo_entities"("kind", "status");

-- CreateIndex
CREATE INDEX "geo_entities_content_version_idx" ON "public"."geo_entities"("content_version");

-- CreateIndex
CREATE INDEX "geo_entity_names_geo_entity_id_locale_idx" ON "public"."geo_entity_names"("geo_entity_id", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "geo_entity_names_geo_entity_id_locale_name_type_value_key" ON "public"."geo_entity_names"("geo_entity_id", "locale", "name_type", "value");

-- CreateIndex
CREATE INDEX "geo_relations_parent_entity_id_taxonomy_code_relation_type_idx" ON "public"."geo_relations"("parent_entity_id", "taxonomy_code", "relation_type");

-- CreateIndex
CREATE INDEX "geo_relations_child_entity_id_taxonomy_code_relation_type_idx" ON "public"."geo_relations"("child_entity_id", "taxonomy_code", "relation_type");

-- CreateIndex
CREATE INDEX "facts_geo_entity_id_fact_type_status_idx" ON "public"."facts"("geo_entity_id", "fact_type", "status");

-- CreateIndex
CREATE INDEX "facts_content_version_idx" ON "public"."facts"("content_version");

-- CreateIndex
CREATE UNIQUE INDEX "currencies_code_key" ON "public"."currencies"("code");

-- CreateIndex
CREATE UNIQUE INDEX "currencies_numeric_code_key" ON "public"."currencies"("numeric_code");

-- CreateIndex
CREATE INDEX "geo_entity_currencies_geo_entity_id_usage_type_idx" ON "public"."geo_entity_currencies"("geo_entity_id", "usage_type");

-- CreateIndex
CREATE UNIQUE INDEX "assets_object_key_key" ON "public"."assets"("object_key");

-- CreateIndex
CREATE INDEX "assets_geo_entity_id_asset_type_status_idx" ON "public"."assets"("geo_entity_id", "asset_type", "status");

-- CreateIndex
CREATE INDEX "assets_sha256_idx" ON "public"."assets"("sha256");

-- CreateIndex
CREATE INDEX "assets_content_version_idx" ON "public"."assets"("content_version");

-- CreateIndex
CREATE UNIQUE INDEX "card_templates_code_schema_version_key" ON "public"."card_templates"("code", "schema_version");

-- CreateIndex
CREATE INDEX "learning_cards_subject_entity_id_template_id_status_idx" ON "public"."learning_cards"("subject_entity_id", "template_id", "status");

-- CreateIndex
CREATE INDEX "learning_cards_content_version_idx" ON "public"."learning_cards"("content_version");

-- CreateIndex
CREATE UNIQUE INDEX "learning_cards_subject_entity_id_template_id_semantic_versi_key" ON "public"."learning_cards"("subject_entity_id", "template_id", "semantic_version");

-- CreateIndex
CREATE INDEX "learning_card_revisions_content_version_idx" ON "public"."learning_card_revisions"("content_version");

-- CreateIndex
CREATE UNIQUE INDEX "learning_card_revisions_learning_card_id_revision_key" ON "public"."learning_card_revisions"("learning_card_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "decks_code_key" ON "public"."decks"("code");

-- CreateIndex
CREATE INDEX "decks_kind_status_idx" ON "public"."decks"("kind", "status");

-- CreateIndex
CREATE INDEX "decks_owner_user_id_idx" ON "public"."decks"("owner_user_id");

-- CreateIndex
CREATE INDEX "decks_content_version_idx" ON "public"."decks"("content_version");

-- CreateIndex
CREATE INDEX "deck_cards_deck_id_sort_order_idx" ON "public"."deck_cards"("deck_id", "sort_order");

-- CreateIndex
CREATE INDEX "study_sessions_user_id_status_started_at_idx" ON "public"."study_sessions"("user_id", "status", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "study_sessions_user_id_id_key" ON "public"."study_sessions"("user_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "study_session_cards_session_id_learning_card_id_key" ON "public"."study_session_cards"("session_id", "learning_card_id");

-- CreateIndex
CREATE UNIQUE INDEX "study_session_cards_session_id_initial_order_key" ON "public"."study_session_cards"("session_id", "initial_order");

-- CreateIndex
CREATE UNIQUE INDEX "study_session_card_options_study_session_card_id_position_key" ON "public"."study_session_card_options"("study_session_card_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "study_session_card_options_study_session_card_id_answer_ent_key" ON "public"."study_session_card_options"("study_session_card_id", "answer_entity_id");

-- CreateIndex
CREATE INDEX "review_events_user_id_learning_card_id_effective_occurred_a_idx" ON "public"."review_events"("user_id", "learning_card_id", "effective_occurred_at", "id");

-- CreateIndex
CREATE INDEX "review_events_session_id_idx" ON "public"."review_events"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_events_user_id_device_id_client_sequence_key" ON "public"."review_events"("user_id", "device_id", "client_sequence");

-- CreateIndex
CREATE INDEX "user_card_states_user_id_due_at_idx" ON "public"."user_card_states"("user_id", "due_at");

-- CreateIndex
CREATE INDEX "scheduler_definitions_status_active_from_idx" ON "public"."scheduler_definitions"("status", "active_from");

-- CreateIndex
CREATE UNIQUE INDEX "scheduler_definitions_version_parameters_version_key" ON "public"."scheduler_definitions"("version", "parameters_version");

-- CreateIndex
CREATE INDEX "scheduler_migration_checkpoints_user_id_learning_card_id_cu_idx" ON "public"."scheduler_migration_checkpoints"("user_id", "learning_card_id", "cutoff_effective_occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "scheduler_migration_checkpoints_user_id_learning_card_id_to_key" ON "public"."scheduler_migration_checkpoints"("user_id", "learning_card_id", "to_scheduler_version");

-- CreateIndex
CREATE UNIQUE INDEX "achievement_definitions_code_rule_version_key" ON "public"."achievement_definitions"("code", "rule_version");

-- CreateIndex
CREATE INDEX "user_achievements_user_id_earned_at_idx" ON "public"."user_achievements"("user_id", "earned_at");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "public"."idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "public"."idempotency_records"("scope", "key");

-- CreateIndex
CREATE INDEX "analytics_outbox_delivery_status_next_attempt_at_idx" ON "public"."analytics_outbox"("delivery_status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "analytics_outbox_expires_at_idx" ON "public"."analytics_outbox"("expires_at");

-- CreateIndex
CREATE INDEX "audit_events_target_type_target_id_occurred_at_idx" ON "public"."audit_events"("target_type", "target_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_user_id_occurred_at_idx" ON "public"."audit_events"("actor_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_expires_at_idx" ON "public"."audit_events"("expires_at");

-- AddForeignKey
ALTER TABLE "public"."auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."refresh_sessions" ADD CONSTRAINT "refresh_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."refresh_sessions" ADD CONSTRAINT "refresh_sessions_rotated_from_id_fkey" FOREIGN KEY ("rotated_from_id") REFERENCES "public"."refresh_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_privacy_settings" ADD CONSTRAINT "user_privacy_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."privacy_consent_events" ADD CONSTRAINT "privacy_consent_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."guest_import_operations" ADD CONSTRAINT "guest_import_operations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."data_export_requests" ADD CONSTRAINT "data_export_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."content_pointers" ADD CONSTRAINT "content_pointers_content_version_fkey" FOREIGN KEY ("content_version") REFERENCES "public"."content_releases"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."content_changes" ADD CONSTRAINT "content_changes_content_version_fkey" FOREIGN KEY ("content_version") REFERENCES "public"."content_releases"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."geo_entities" ADD CONSTRAINT "geo_entities_content_version_fkey" FOREIGN KEY ("content_version") REFERENCES "public"."content_releases"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."geo_entity_names" ADD CONSTRAINT "geo_entity_names_geo_entity_id_fkey" FOREIGN KEY ("geo_entity_id") REFERENCES "public"."geo_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."geo_entity_names" ADD CONSTRAINT "geo_entity_names_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."geo_relations" ADD CONSTRAINT "geo_relations_parent_entity_id_fkey" FOREIGN KEY ("parent_entity_id") REFERENCES "public"."geo_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."geo_relations" ADD CONSTRAINT "geo_relations_child_entity_id_fkey" FOREIGN KEY ("child_entity_id") REFERENCES "public"."geo_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."facts" ADD CONSTRAINT "facts_geo_entity_id_fkey" FOREIGN KEY ("geo_entity_id") REFERENCES "public"."geo_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."facts" ADD CONSTRAINT "facts_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."facts" ADD CONSTRAINT "facts_content_version_fkey" FOREIGN KEY ("content_version") REFERENCES "public"."content_releases"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."currency_names" ADD CONSTRAINT "currency_names_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."geo_entity_currencies" ADD CONSTRAINT "geo_entity_currencies_geo_entity_id_fkey" FOREIGN KEY ("geo_entity_id") REFERENCES "public"."geo_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."geo_entity_currencies" ADD CONSTRAINT "geo_entity_currencies_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."geo_entity_currencies" ADD CONSTRAINT "geo_entity_currencies_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."assets" ADD CONSTRAINT "assets_geo_entity_id_fkey" FOREIGN KEY ("geo_entity_id") REFERENCES "public"."geo_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."assets" ADD CONSTRAINT "assets_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."assets" ADD CONSTRAINT "assets_content_version_fkey" FOREIGN KEY ("content_version") REFERENCES "public"."content_releases"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."learning_cards" ADD CONSTRAINT "learning_cards_subject_entity_id_fkey" FOREIGN KEY ("subject_entity_id") REFERENCES "public"."geo_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."learning_cards" ADD CONSTRAINT "learning_cards_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."card_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."learning_cards" ADD CONSTRAINT "learning_cards_content_version_fkey" FOREIGN KEY ("content_version") REFERENCES "public"."content_releases"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."learning_cards" ADD CONSTRAINT "learning_cards_supersedes_learning_card_id_fkey" FOREIGN KEY ("supersedes_learning_card_id") REFERENCES "public"."learning_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."learning_card_revisions" ADD CONSTRAINT "learning_card_revisions_learning_card_id_fkey" FOREIGN KEY ("learning_card_id") REFERENCES "public"."learning_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."learning_card_revisions" ADD CONSTRAINT "learning_card_revisions_prompt_asset_id_fkey" FOREIGN KEY ("prompt_asset_id") REFERENCES "public"."assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."learning_card_revisions" ADD CONSTRAINT "learning_card_revisions_content_version_fkey" FOREIGN KEY ("content_version") REFERENCES "public"."content_releases"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."decks" ADD CONSTRAINT "decks_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."decks" ADD CONSTRAINT "decks_content_version_fkey" FOREIGN KEY ("content_version") REFERENCES "public"."content_releases"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deck_localizations" ADD CONSTRAINT "deck_localizations_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deck_cards" ADD CONSTRAINT "deck_cards_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deck_cards" ADD CONSTRAINT "deck_cards_learning_card_id_fkey" FOREIGN KEY ("learning_card_id") REFERENCES "public"."learning_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."study_sessions" ADD CONSTRAINT "study_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."study_sessions" ADD CONSTRAINT "study_sessions_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."study_sessions" ADD CONSTRAINT "study_sessions_content_version_fkey" FOREIGN KEY ("content_version") REFERENCES "public"."content_releases"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."study_sessions" ADD CONSTRAINT "study_sessions_scheduler_version_fkey" FOREIGN KEY ("scheduler_version") REFERENCES "public"."scheduler_definitions"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."study_session_cards" ADD CONSTRAINT "study_session_cards_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."study_session_cards" ADD CONSTRAINT "study_session_cards_learning_card_id_fkey" FOREIGN KEY ("learning_card_id") REFERENCES "public"."learning_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."study_session_cards" ADD CONSTRAINT "study_session_cards_learning_card_revision_id_fkey" FOREIGN KEY ("learning_card_revision_id") REFERENCES "public"."learning_card_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."study_session_card_options" ADD CONSTRAINT "study_session_card_options_study_session_card_id_fkey" FOREIGN KEY ("study_session_card_id") REFERENCES "public"."study_session_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."study_session_card_options" ADD CONSTRAINT "study_session_card_options_answer_entity_id_fkey" FOREIGN KEY ("answer_entity_id") REFERENCES "public"."geo_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_events" ADD CONSTRAINT "review_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_events" ADD CONSTRAINT "review_events_learning_card_id_fkey" FOREIGN KEY ("learning_card_id") REFERENCES "public"."learning_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_events" ADD CONSTRAINT "review_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_events" ADD CONSTRAINT "review_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_events" ADD CONSTRAINT "review_events_selected_option_id_fkey" FOREIGN KEY ("selected_option_id") REFERENCES "public"."study_session_card_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_events" ADD CONSTRAINT "review_events_scheduler_version_fkey" FOREIGN KEY ("scheduler_version") REFERENCES "public"."scheduler_definitions"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_card_states" ADD CONSTRAINT "user_card_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_card_states" ADD CONSTRAINT "user_card_states_learning_card_id_fkey" FOREIGN KEY ("learning_card_id") REFERENCES "public"."learning_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_card_states" ADD CONSTRAINT "user_card_states_scheduler_version_fkey" FOREIGN KEY ("scheduler_version") REFERENCES "public"."scheduler_definitions"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."scheduler_migration_checkpoints" ADD CONSTRAINT "scheduler_migration_checkpoints_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."scheduler_migration_checkpoints" ADD CONSTRAINT "scheduler_migration_checkpoints_learning_card_id_fkey" FOREIGN KEY ("learning_card_id") REFERENCES "public"."learning_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."scheduler_migration_checkpoints" ADD CONSTRAINT "scheduler_migration_checkpoints_from_scheduler_version_fkey" FOREIGN KEY ("from_scheduler_version") REFERENCES "public"."scheduler_definitions"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."scheduler_migration_checkpoints" ADD CONSTRAINT "scheduler_migration_checkpoints_to_scheduler_version_fkey" FOREIGN KEY ("to_scheduler_version") REFERENCES "public"."scheduler_definitions"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."achievement_localizations" ADD CONSTRAINT "achievement_localizations_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "public"."achievement_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_achievements" ADD CONSTRAINT "user_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_achievements" ADD CONSTRAINT "user_achievements_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "public"."achievement_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_deck_mastery" ADD CONSTRAINT "user_deck_mastery_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_deck_mastery" ADD CONSTRAINT "user_deck_mastery_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain checks that Prisma schema syntax cannot express.
ALTER TABLE "public"."users"
  ADD CONSTRAINT "users_deletion_timestamps_check" CHECK (
    ("status" = 'ACTIVE' AND "deletion_requested_at" IS NULL AND "deleted_at" IS NULL)
    OR ("status" = 'DELETION_PENDING' AND "deletion_requested_at" IS NOT NULL AND "deleted_at" IS NULL)
    OR ("status" = 'DELETED' AND "deletion_requested_at" IS NOT NULL AND "deleted_at" IS NOT NULL)
    OR ("status" = 'BLOCKED' AND "deleted_at" IS NULL)
  );

ALTER TABLE "public"."refresh_sessions"
  ADD CONSTRAINT "refresh_sessions_expiry_check" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "refresh_sessions_revocation_check" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at");

ALTER TABLE "public"."user_settings"
  ALTER COLUMN "extra_fact_types" SET NOT NULL,
  ALTER COLUMN "reminder_weekdays" SET NOT NULL,
  ADD CONSTRAINT "user_settings_session_size_check" CHECK ("session_size" IN (5, 10, 20)),
  ADD CONSTRAINT "user_settings_retention_check" CHECK ("desired_retention" > 0 AND "desired_retention" <= 1),
  ADD CONSTRAINT "user_settings_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "user_settings_weekdays_check" CHECK (
    "reminder_weekdays" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]
    AND cardinality("reminder_weekdays") <= 7
  );

ALTER TABLE "public"."guest_import_operations"
  ADD CONSTRAINT "guest_import_counts_check" CHECK (
    "accepted_event_count" >= 0
    AND "duplicate_event_count" >= 0
    AND "rejected_event_count" >= 0
  ),
  ADD CONSTRAINT "guest_import_completion_check" CHECK (
    ("status" = 'PENDING' AND "completed_at" IS NULL)
    OR ("status" <> 'PENDING' AND "completed_at" IS NOT NULL)
  );

ALTER TABLE "public"."data_export_requests"
  ADD CONSTRAINT "data_export_sha256_check" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "data_export_completion_check" CHECK (
    ("status" IN ('PENDING', 'PROCESSING') AND "completed_at" IS NULL)
    OR ("status" IN ('READY', 'EXPIRED', 'FAILED') AND "completed_at" IS NOT NULL)
  );

ALTER TABLE "public"."content_releases"
  ADD CONSTRAINT "content_release_schema_version_check" CHECK ("schema_version" > 0),
  ADD CONSTRAINT "content_release_checksum_check" CHECK ("manifest_checksum" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "content_release_lifecycle_check" CHECK (
    ("status" = 'DRAFT' AND "published_at" IS NULL AND "retired_at" IS NULL)
    OR ("status" = 'PUBLISHED' AND "published_at" IS NOT NULL AND "retired_at" IS NULL)
    OR ("status" = 'RETIRED' AND "published_at" IS NOT NULL AND "retired_at" IS NOT NULL)
  );

ALTER TABLE "public"."geo_entities"
  ADD CONSTRAINT "geo_entities_validity_check" CHECK ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" >= "valid_from"),
  ADD CONSTRAINT "geo_entities_iso_alpha2_check" CHECK ("iso_alpha2" IS NULL OR "iso_alpha2" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "geo_entities_iso_alpha3_check" CHECK ("iso_alpha3" IS NULL OR "iso_alpha3" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "geo_entities_m49_check" CHECK ("m49_code" IS NULL OR "m49_code" ~ '^[0-9]{3}$'),
  ADD CONSTRAINT "geo_entities_recognition_check" CHECK (
    "kind" NOT IN ('COUNTRY', 'TERRITORY', 'DEPENDENCY', 'DISPUTED_AREA')
    OR "recognition_status" IS NOT NULL
  );

CREATE UNIQUE INDEX "geo_entities_iso_alpha2_unique"
  ON "public"."geo_entities" ("iso_alpha2")
  WHERE "iso_alpha2" IS NOT NULL;
CREATE UNIQUE INDEX "geo_entities_iso_alpha3_unique"
  ON "public"."geo_entities" ("iso_alpha3")
  WHERE "iso_alpha3" IS NOT NULL;
CREATE UNIQUE INDEX "geo_entities_m49_code_unique"
  ON "public"."geo_entities" ("m49_code")
  WHERE "m49_code" IS NOT NULL;

CREATE UNIQUE INDEX "geo_entity_names_one_primary_per_locale_type"
  ON "public"."geo_entity_names" ("geo_entity_id", "locale", "name_type")
  WHERE "is_primary";

ALTER TABLE "public"."geo_relations"
  ADD CONSTRAINT "geo_relations_no_self_reference_check" CHECK ("parent_entity_id" <> "child_entity_id"),
  ADD CONSTRAINT "geo_relations_validity_check" CHECK ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" >= "valid_from"),
  ADD CONSTRAINT "geo_relations_sort_order_check" CHECK ("sort_order" IS NULL OR "sort_order" >= 0);

CREATE UNIQUE INDEX "geo_relations_identity_unique"
  ON "public"."geo_relations" (
    "parent_entity_id",
    "child_entity_id",
    "taxonomy_code",
    "relation_type",
    "valid_from"
  ) NULLS NOT DISTINCT;

ALTER TABLE "public"."facts"
  ADD CONSTRAINT "facts_effective_range_check" CHECK ("effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" >= "effective_from");

ALTER TABLE "public"."currencies"
  ADD CONSTRAINT "currencies_code_check" CHECK ("code" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "currencies_numeric_code_check" CHECK ("numeric_code" IS NULL OR "numeric_code" ~ '^[0-9]{3}$'),
  ADD CONSTRAINT "currencies_decimals_check" CHECK ("decimals" IS NULL OR "decimals" BETWEEN 0 AND 9);

ALTER TABLE "public"."geo_entity_currencies"
  ADD CONSTRAINT "geo_entity_currencies_validity_check" CHECK ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" >= "valid_from");

CREATE UNIQUE INDEX "geo_entity_currencies_identity_unique"
  ON "public"."geo_entity_currencies" ("geo_entity_id", "currency_id", "usage_type", "valid_from")
  NULLS NOT DISTINCT;

ALTER TABLE "public"."assets"
  ADD CONSTRAINT "assets_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "assets_dimensions_check" CHECK (
    ("width" IS NULL OR "width" > 0)
    AND ("height" IS NULL OR "height" > 0)
    AND ("aspect_ratio" IS NULL OR "aspect_ratio" > 0)
  ),
  ADD CONSTRAINT "assets_validity_check" CHECK ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" >= "valid_from");

ALTER TABLE "public"."card_templates"
  ALTER COLUMN "back_side_fact_types" SET NOT NULL,
  ADD CONSTRAINT "card_templates_schema_version_check" CHECK ("schema_version" > 0);

ALTER TABLE "public"."learning_cards"
  ADD CONSTRAINT "learning_cards_semantic_version_check" CHECK ("semantic_version" > 0),
  ADD CONSTRAINT "learning_cards_no_self_supersession_check" CHECK ("supersedes_learning_card_id" IS NULL OR "supersedes_learning_card_id" <> "id");

CREATE UNIQUE INDEX "learning_cards_one_active_per_subject_template"
  ON "public"."learning_cards" ("subject_entity_id", "template_id")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "public"."learning_card_revisions"
  ADD CONSTRAINT "learning_card_revisions_revision_check" CHECK ("revision" > 0),
  ADD CONSTRAINT "learning_card_revisions_retirement_check" CHECK ("retired_at" IS NULL OR "retired_at" >= "effective_from");

ALTER TABLE "public"."decks"
  ADD CONSTRAINT "decks_owner_check" CHECK (
    ("kind" IN ('DYNAMIC_USER', 'CUSTOM') AND "owner_user_id" IS NOT NULL)
    OR ("kind" IN ('CURATED', 'TAXONOMY') AND "owner_user_id" IS NULL)
  );

ALTER TABLE "public"."deck_cards"
  ADD CONSTRAINT "deck_cards_sort_order_check" CHECK ("sort_order" IS NULL OR "sort_order" >= 0),
  ADD CONSTRAINT "deck_cards_membership_version_check" CHECK ("membership_version" > 0);

ALTER TABLE "public"."study_sessions"
  ADD CONSTRAINT "study_sessions_requested_count_check" CHECK ("requested_unique_count" IN (5, 10, 20)),
  ADD CONSTRAINT "study_sessions_selected_count_check" CHECK (
    "selected_unique_count" >= 0 AND "selected_unique_count" <= "requested_unique_count"
  ),
  ADD CONSTRAINT "study_sessions_completion_check" CHECK (
    ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL)
    OR ("status" <> 'COMPLETED' AND "completed_at" IS NULL)
  );

ALTER TABLE "public"."study_session_cards"
  ADD CONSTRAINT "study_session_cards_order_check" CHECK ("initial_order" >= 0),
  ADD CONSTRAINT "study_session_cards_state_version_check" CHECK ("state_version_at_selection" IS NULL OR "state_version_at_selection" > 0);

ALTER TABLE "public"."study_session_card_options"
  ADD CONSTRAINT "study_session_card_options_position_check" CHECK ("position" >= 0);

CREATE UNIQUE INDEX "study_session_card_options_one_correct"
  ON "public"."study_session_card_options" ("study_session_card_id")
  WHERE "is_correct";

ALTER TABLE "public"."review_events"
  ADD CONSTRAINT "review_events_response_time_check" CHECK ("response_time_ms" IS NULL OR "response_time_ms" >= 0),
  ADD CONSTRAINT "review_events_client_sequence_check" CHECK ("client_sequence" > 0),
  ADD CONSTRAINT "review_events_versions_check" CHECK (
    "payload_version" > 0 AND ("base_state_version" IS NULL OR "base_state_version" > 0)
  ),
  ADD CONSTRAINT "review_events_payload_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "review_events_grading_check" CHECK (
    (
      "answer_mode" = 'SELF_RATED'
      AND "selected_option_id" IS NULL
      AND (("rating" = 'AGAIN' AND NOT "is_correct") OR ("rating" IN ('HARD', 'GOOD', 'EASY') AND "is_correct"))
    )
    OR (
      "answer_mode" = 'MULTIPLE_CHOICE'
      AND "selected_option_id" IS NOT NULL
      AND (("rating" = 'AGAIN' AND NOT "is_correct") OR ("rating" = 'GOOD' AND "is_correct"))
    )
    OR ("answer_mode" = 'TEXT' AND "selected_option_id" IS NULL)
  );

ALTER TABLE "public"."user_card_states"
  ADD CONSTRAINT "user_card_states_values_check" CHECK (
    "difficulty" >= 0
    AND "stability" >= 0
    AND ("retrievability_at_review" IS NULL OR "retrievability_at_review" BETWEEN 0 AND 1)
    AND "repetitions" >= 0
    AND "lapses" >= 0
    AND "state_version" > 0
  );

ALTER TABLE "public"."scheduler_definitions"
  ADD CONSTRAINT "scheduler_definitions_values_check" CHECK (
    "algorithm_major" > 0 AND "default_desired_retention" > 0 AND "default_desired_retention" <= 1
  ),
  ADD CONSTRAINT "scheduler_definitions_activation_check" CHECK (
    ("status" = 'DRAFT' AND "active_from" IS NULL)
    OR ("status" <> 'DRAFT' AND "active_from" IS NOT NULL)
  );

CREATE UNIQUE INDEX "scheduler_definitions_one_active"
  ON "public"."scheduler_definitions" ("status")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "public"."scheduler_migration_checkpoints"
  ADD CONSTRAINT "scheduler_migration_versions_check" CHECK ("from_scheduler_version" <> "to_scheduler_version"),
  ADD CONSTRAINT "scheduler_migration_checksum_check" CHECK ("state_checksum" ~ '^[0-9a-f]{64}$');

ALTER TABLE "public"."achievement_definitions"
  ADD CONSTRAINT "achievement_definitions_rule_version_check" CHECK ("rule_version" > 0),
  ADD CONSTRAINT "achievement_definitions_active_range_check" CHECK ("active_to" IS NULL OR "active_to" >= "active_from");

CREATE UNIQUE INDEX "user_achievements_once_per_scope"
  ON "public"."user_achievements" ("user_id", "definition_id", "scope_type", "scope_id")
  NULLS NOT DISTINCT;

ALTER TABLE "public"."user_deck_mastery"
  ADD CONSTRAINT "user_deck_mastery_counts_check" CHECK (
    "mastered_card_count" >= 0
    AND "total_card_count" >= 0
    AND "mastered_card_count" <= "total_card_count"
    AND "projection_version" > 0
  );

ALTER TABLE "public"."idempotency_records"
  ADD CONSTRAINT "idempotency_records_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "idempotency_records_expiry_check" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "idempotency_records_completion_check" CHECK (
    ("status" = 'PROCESSING' AND "completed_at" IS NULL AND "response_status" IS NULL)
    OR ("status" <> 'PROCESSING' AND "completed_at" IS NOT NULL AND "response_status" IS NOT NULL)
  );

ALTER TABLE "public"."analytics_outbox"
  ADD CONSTRAINT "analytics_outbox_values_check" CHECK (
    "schema_version" > 0
    AND "attempt_count" >= 0
    AND "expires_at" > "received_at"
    AND ("delivered_at" IS NULL OR "delivered_at" >= "received_at")
  );

-- Canonical history is append-only. DELETE remains available only for explicit
-- account/privacy retention workflows and their FK cascades.
CREATE FUNCTION "public"."reject_immutable_row_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'updates are forbidden for immutable table %', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "review_events_immutable"
  BEFORE UPDATE ON "public"."review_events"
  FOR EACH ROW EXECUTE FUNCTION "public"."reject_immutable_row_update"();

CREATE TRIGGER "privacy_consent_events_immutable"
  BEFORE UPDATE ON "public"."privacy_consent_events"
  FOR EACH ROW EXECUTE FUNCTION "public"."reject_immutable_row_update"();

CREATE TRIGGER "content_changes_immutable"
  BEFORE UPDATE ON "public"."content_changes"
  FOR EACH ROW EXECUTE FUNCTION "public"."reject_immutable_row_update"();

CREATE TRIGGER "audit_events_immutable"
  BEFORE UPDATE ON "public"."audit_events"
  FOR EACH ROW EXECUTE FUNCTION "public"."reject_immutable_row_update"();

CREATE FUNCTION "public"."protect_published_scheduler_definition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND (
    NEW."algorithm" IS DISTINCT FROM OLD."algorithm"
    OR NEW."algorithm_major" IS DISTINCT FROM OLD."algorithm_major"
    OR NEW."package_name" IS DISTINCT FROM OLD."package_name"
    OR NEW."package_version" IS DISTINCT FROM OLD."package_version"
    OR NEW."parameters_version" IS DISTINCT FROM OLD."parameters_version"
    OR NEW."parameters" IS DISTINCT FROM OLD."parameters"
    OR NEW."default_desired_retention" IS DISTINCT FROM OLD."default_desired_retention"
  ) THEN
    RAISE EXCEPTION 'published scheduler definition fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "scheduler_definitions_immutable_after_publish"
  BEFORE UPDATE ON "public"."scheduler_definitions"
  FOR EACH ROW EXECUTE FUNCTION "public"."protect_published_scheduler_definition"();
