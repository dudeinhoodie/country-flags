import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

interface TableRow {
  tablename: string;
}

interface CountRow {
  count: bigint;
}

const REQUIRED_TABLES = [
  "admin_audit_events",
  "admin_identities",
  "admin_sessions",
  "admin_users",
  "analytics_outbox",
  "content_drafts",
  "draft_assets",
  "asset_localizations",
  "audit_events",
  "auth_rate_limit_buckets",
  "auth_identities",
  "commerce_offer_grants",
  "commerce_offer_localizations",
  "commerce_offers",
  "content_changes",
  "content_releases",
  "decks",
  "devices",
  "entitlement_definitions",
  "geo_entities",
  "guest_import_operations",
  "idempotency_records",
  "learning_cards",
  "learning_outbox",
  "privacy_consent_events",
  "refresh_sessions",
  "reconciliation_jobs",
  "review_events",
  "scheduler_definitions",
  "scheduler_migration_checkpoints",
  "scheduler_migration_runs",
  "store_notifications",
  "store_products",
  "store_reconciliation_state",
  "store_transactions",
  "study_sessions",
  "user_achievements",
  "user_entitlement_grants",
  "user_card_states",
  "user_changes",
  "users",
];

function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

describe("baseline database migration (integration)", () => {
  jest.setTimeout(60_000);

  const baseUrl = process.env.DATABASE_URL;
  const databaseName =
    `country_flags_migration_${process.pid}_${Date.now()}`.toLowerCase();
  let admin: PrismaClient;
  let database: PrismaClient | undefined;

  beforeAll(async () => {
    if (baseUrl === undefined) {
      throw new Error(
        "DATABASE_URL is required for migration integration test",
      );
    }

    admin = new PrismaClient({
      datasources: { db: { url: baseUrl } },
    });
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);

    const testDatabaseUrl = databaseUrlFor(baseUrl, databaseName);
    const prismaCli = require.resolve("prisma/build/index.js");
    const migration = spawnSync(
      process.execPath,
      [
        prismaCli,
        "migrate",
        "deploy",
        "--schema",
        resolve(__dirname, "../prisma/schema.prisma"),
      ],
      {
        cwd: resolve(__dirname, ".."),
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: testDatabaseUrl,
          // The schema's directUrl drives `migrate deploy`; without this the
          // migrations would land on the ambient database, not the temporary one.
          DIRECT_DATABASE_URL: testDatabaseUrl,
        },
      },
    );

    if (migration.status !== 0) {
      throw new Error(
        `Baseline migration failed:\n${migration.stdout}\n${migration.stderr}`,
      );
    }

    database = new PrismaClient({
      datasources: { db: { url: testDatabaseUrl } },
    });
    await database.$connect();
  });

  afterAll(async () => {
    await database?.$disconnect();
    if (admin !== undefined) {
      await admin.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
      await admin.$disconnect();
    }
  });

  it("creates the complete schema in an empty PostgreSQL database", async () => {
    const tables = await database!.$queryRaw<TableRow[]>`
      SELECT tablename
      FROM pg_catalog.pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;
    const tableNames = tables.map(({ tablename }) => tablename);

    expect(tableNames).toEqual(expect.arrayContaining(REQUIRED_TABLES));
    expect(tableNames).toContain("_prisma_migrations");

    const nonUtcTimestamps = await database!.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type = 'timestamp without time zone'
    `;
    expect(nonUtcTimestamps[0]?.count).toBe(0n);
  });

  it("enforces identity, content, and review idempotency invariants", async () => {
    const firstUserId = "10000000-0000-4000-8000-000000000001";
    const secondUserId = "10000000-0000-4000-8000-000000000002";
    const contentRelease = "test-content-v1";
    const entityId = "20000000-0000-4000-8000-000000000001";
    const templateId = "30000000-0000-4000-8000-000000000001";
    const cardId = "40000000-0000-4000-8000-000000000001";
    const reviewId = "50000000-0000-4000-8000-000000000001";

    await database!.$executeRawUnsafe(`
      INSERT INTO users (id, preferred_locale, status, created_at, updated_at)
      VALUES
        ('${firstUserId}', 'ru', 'ACTIVE', now(), now()),
        ('${secondUserId}', 'ru', 'ACTIVE', now(), now())
    `);
    await database!.$executeRawUnsafe(`
      INSERT INTO auth_identities (
        id, user_id, provider, provider_subject, created_at, last_login_at
      )
      VALUES (
        '11000000-0000-4000-8000-000000000001',
        '${firstUserId}',
        'APPLE',
        'provider-subject',
        now(),
        now()
      )
    `);

    await expect(
      database!.$executeRawUnsafe(`
        INSERT INTO auth_identities (
          id, user_id, provider, provider_subject, created_at, last_login_at
        )
        VALUES (
          '11000000-0000-4000-8000-000000000002',
          '${secondUserId}',
          'APPLE',
          'provider-subject',
          now(),
          now()
        )
      `),
    ).rejects.toThrow();

    await database!.$executeRawUnsafe(`
      INSERT INTO content_releases (
        version, schema_version, status, manifest_checksum, metadata, created_at
      )
      VALUES (
        '${contentRelease}',
        1,
        'DRAFT',
        '${"a".repeat(64)}',
        '{}'::jsonb,
        now()
      )
    `);
    await database!.$executeRawUnsafe(`
      INSERT INTO geo_entities (
        id,
        content_key,
        kind,
        slug,
        iso_alpha2,
        status,
        include_in_country_catalog,
        recognition_status,
        metadata,
        content_version,
        created_at,
        updated_at
      )
      VALUES (
        '${entityId}',
        'country.test',
        'COUNTRY',
        'test',
        'TT',
        'ACTIVE',
        true,
        'UN_MEMBER',
        '{}'::jsonb,
        '${contentRelease}',
        now(),
        now()
      )
    `);

    await expect(
      database!.$executeRawUnsafe(`
        INSERT INTO geo_entities (
          id,
          content_key,
          kind,
          slug,
          iso_alpha2,
          status,
          include_in_country_catalog,
          recognition_status,
          metadata,
          content_version,
          created_at,
          updated_at
        )
        VALUES (
          '20000000-0000-4000-8000-000000000002',
          'country.test',
          'COUNTRY',
          'test-duplicate',
          'TD',
          'ACTIVE',
          true,
          'UN_MEMBER',
          '{}'::jsonb,
          '${contentRelease}',
          now(),
          now()
        )
      `),
    ).rejects.toThrow();

    await database!.$executeRawUnsafe(`
      INSERT INTO card_templates (
        id,
        code,
        schema_version,
        prompt_type,
        answer_type,
        grading_mode,
        prompt_spec,
        answer_spec,
        status,
        created_at,
        updated_at
      )
      VALUES (
        '${templateId}',
        'FLAG_TO_COUNTRY',
        1,
        'FLAG',
        'COUNTRY',
        'SELF_RATED',
        '{}'::jsonb,
        '{}'::jsonb,
        'PUBLISHED',
        now(),
        now()
      )
    `);
    await database!.$executeRawUnsafe(`
      INSERT INTO learning_cards (
        id,
        subject_entity_id,
        template_id,
        semantic_version,
        status,
        content_version,
        created_at,
        updated_at
      )
      VALUES (
        '${cardId}',
        '${entityId}',
        '${templateId}',
        1,
        'ACTIVE',
        '${contentRelease}',
        now(),
        now()
      )
    `);
    await database!.$executeRawUnsafe(`
      INSERT INTO scheduler_definitions (
        version,
        algorithm,
        algorithm_major,
        package_name,
        package_version,
        parameters_version,
        parameters,
        default_desired_retention,
        status,
        created_at
      )
      VALUES (
        'fsrs-6/test',
        'FSRS',
        6,
        'ts-fsrs',
        'test',
        'test-v1',
        '{}'::jsonb,
        0.900,
        'DRAFT',
        now()
      )
    `);

    const insertReview = `
      INSERT INTO review_events (
        id,
        user_id,
        learning_card_id,
        rating,
        is_correct,
        answer_mode,
        client_occurred_at,
        effective_occurred_at,
        received_at,
        client_sequence,
        time_confidence,
        scheduler_version,
        scheduler_parameters_version,
        payload_version,
        payload_hash,
        metadata
      )
      VALUES (
        '${reviewId}',
        '${firstUserId}',
        '${cardId}',
        'GOOD',
        true,
        'SELF_RATED',
        now(),
        now(),
        now(),
        1,
        'RECEIVED_AT_FALLBACK',
        'fsrs-6/test',
        'test-v1',
        1,
        '${"b".repeat(64)}',
        '{}'::jsonb
      )
    `;
    await database!.$executeRawUnsafe(insertReview);
    await expect(database!.$executeRawUnsafe(insertReview)).rejects.toThrow();

    await expect(
      database!.$executeRawUnsafe(`
        UPDATE review_events
        SET metadata = '{"mutated": true}'::jsonb
        WHERE user_id = '${firstUserId}' AND id = '${reviewId}'
      `),
    ).rejects.toThrow(
      "updates are forbidden for immutable table review_events",
    );
  });

  it("enforces immutable change rows and one active reconciliation job", async () => {
    const userId = "10000000-0000-4000-8000-000000000001";
    const cardId = "40000000-0000-4000-8000-000000000001";
    const changeId = "51000000-0000-4000-8000-000000000001";
    await database!.$executeRawUnsafe(`
      INSERT INTO user_changes (
        user_id, operation, resource_type, resource_id,
        source_operation_id, payload, occurred_at
      ) VALUES (
        '${userId}', 'UPSERT', 'CARD_STATE', '${cardId}',
        '${changeId}', '{}'::jsonb, now()
      )
    `);
    await expect(
      database!.$executeRawUnsafe(`
        UPDATE user_changes SET payload = '{"changed":true}'::jsonb
        WHERE source_operation_id = '${changeId}'
      `),
    ).rejects.toThrow("updates are forbidden for immutable table user_changes");
    await expect(
      database!.$executeRawUnsafe(`
        INSERT INTO user_changes (
          user_id, operation, resource_type, resource_id,
          source_operation_id, payload, occurred_at
        ) VALUES (
          '${userId}', 'TOMBSTONE', 'CARD_STATE', '${cardId}',
          '51000000-0000-4000-8000-000000000002', '{}'::jsonb, now()
        )
      `),
    ).rejects.toThrow();

    const insertJob = (id: string): Promise<number> =>
      database!.$executeRawUnsafe(`
        INSERT INTO reconciliation_jobs (
          id, user_id, learning_card_id, target_scheduler_version,
          reason, created_at, updated_at
        ) VALUES (
          '${id}', '${userId}', '${cardId}', 'fsrs-6/test',
          'TEST', now(), now()
        )
      `);
    await insertJob("52000000-0000-4000-8000-000000000001");
    await expect(
      insertJob("52000000-0000-4000-8000-000000000002"),
    ).rejects.toThrow();
    await database!.$executeRawUnsafe(`
      UPDATE reconciliation_jobs
      SET status = 'COMPLETED', completed_at = now(), updated_at = now()
      WHERE id = '52000000-0000-4000-8000-000000000001'
    `);
    await expect(
      insertJob("52000000-0000-4000-8000-000000000002"),
    ).resolves.toBe(1);
  });

  it("makes a purchase land once and a right survive one of its sources", async () => {
    const userId = "60000000-0000-4000-8000-000000000001";
    const contentRelease = "commerce-content-v1";
    const offerId = "61000000-0000-4000-8000-000000000001";
    const firstTransactionId = "62000000-0000-4000-8000-000000000001";
    const secondTransactionId = "62000000-0000-4000-8000-000000000002";

    await database!.$executeRawUnsafe(`
      INSERT INTO users (id, preferred_locale, status, created_at, updated_at)
      VALUES ('${userId}', 'ru', 'ACTIVE', now(), now())
    `);
    await database!.$executeRawUnsafe(`
      INSERT INTO content_releases (
        version, schema_version, status, manifest_checksum, metadata, created_at
      )
      VALUES (
        '${contentRelease}', 1, 'DRAFT', '${"c".repeat(64)}', '{}'::jsonb, now()
      )
    `);
    await database!.$executeRawUnsafe(`
      INSERT INTO entitlement_definitions (key, status, created_at, updated_at)
      VALUES ('deck.europe_coats', 'ACTIVE', now(), now())
    `);
    await database!.$executeRawUnsafe(`
      INSERT INTO commerce_offers (id, code, kind, status, created_at, updated_at)
      VALUES ('${offerId}', 'EUROPE_COATS_LIFETIME', 'ONE_TIME', 'ACTIVE', now(), now())
    `);
    await database!.$executeRawUnsafe(`
      INSERT INTO commerce_offer_grants (offer_id, entitlement_key)
      VALUES ('${offerId}', 'deck.europe_coats')
    `);

    // A store account token is minted for every account, including the ones
    // that existed before there was anything to buy.
    const tokens = await database!.$queryRawUnsafe<{ token: string | null }[]>(`
      SELECT store_account_token::text AS token FROM users WHERE id = '${userId}'
    `);
    expect(tokens[0]?.token).toMatch(/^[0-9a-f-]{36}$/);

    const insertTransaction = (
      id: string,
      transactionId: string,
    ): Promise<number> =>
      database!.$executeRawUnsafe(`
        INSERT INTO store_transactions (
          id, provider, store_environment, transaction_id, product_id,
          user_id, purchased_at, signed_payload_hash, verified_at,
          created_at, updated_at
        ) VALUES (
          '${id}', 'APPLE_APP_STORE', 'SANDBOX', '${transactionId}',
          'app.countryflags.dev.deck.europe_coats.lifetime.v1',
          '${userId}', now(), '${"d".repeat(64)}', now(), now(), now()
        )
      `);

    await insertTransaction(firstTransactionId, "2000000000000001");
    // The same purchase delivered again — by the app, by a notification, by
    // the repair job — must not become a second row.
    await expect(
      insertTransaction(
        "62000000-0000-4000-8000-0000000000ff",
        "2000000000000001",
      ),
    ).rejects.toThrow();
    await insertTransaction(secondTransactionId, "2000000000000002");

    const grant = (id: string, transactionId: string): Promise<number> =>
      database!.$executeRawUnsafe(`
        INSERT INTO user_entitlement_grants (
          id, user_id, entitlement_key, source_type, source_transaction_id,
          status, granted_at, created_at, updated_at
        ) VALUES (
          '${id}', '${userId}', 'deck.europe_coats', 'STORE_TRANSACTION',
          '${transactionId}', 'ACTIVE', now(), now(), now()
        )
      `);
    await grant("63000000-0000-4000-8000-000000000001", firstTransactionId);
    await grant("63000000-0000-4000-8000-000000000002", secondTransactionId);

    // A refund of one product does not close a right the other still grants.
    await database!.$executeRawUnsafe(`
      UPDATE user_entitlement_grants
      SET status = 'REVOKED', revoked_at = now(), revocation_reason = 'REFUND',
          updated_at = now()
      WHERE source_transaction_id = '${firstTransactionId}'
    `);
    const active = await database!.$queryRawUnsafe<CountRow[]>(`
      SELECT COUNT(*)::bigint AS count
      FROM user_entitlement_grants
      WHERE user_id = '${userId}'
        AND entitlement_key = 'deck.europe_coats'
        AND status = 'ACTIVE'
    `);
    expect(active[0]?.count).toBe(1n);

    // A grant with no transaction behind it still cannot be issued twice:
    // the index is NULLS NOT DISTINCT, or nothing would stop a migration
    // from running itself into duplicates.
    const migrationGrant = (id: string): Promise<number> =>
      database!.$executeRawUnsafe(`
        INSERT INTO user_entitlement_grants (
          id, user_id, entitlement_key, source_type, status,
          granted_at, created_at, updated_at
        ) VALUES (
          '${id}', '${userId}', 'deck.europe_coats', 'MIGRATION', 'ACTIVE',
          now(), now(), now()
        )
      `);
    await migrationGrant("63000000-0000-4000-8000-000000000003");
    await expect(
      migrationGrant("63000000-0000-4000-8000-000000000004"),
    ).rejects.toThrow();

    // Access policy and the right it names travel together.
    const deck = (
      id: string,
      code: string,
      model: string,
      key: string,
    ): Promise<number> =>
      database!.$executeRawUnsafe(`
        INSERT INTO decks (
          id, code, kind, status, access_model, required_entitlement_key,
          content_version, created_at, updated_at
        ) VALUES (
          '${id}', '${code}', 'CURATED', 'PUBLISHED', '${model}', ${key},
          '${contentRelease}', now(), now()
        )
      `);
    await deck(
      "64000000-0000-4000-8000-000000000001",
      "EUROPEAN_COATS",
      "ENTITLEMENT",
      "'deck.europe_coats'",
    );
    await expect(
      deck(
        "64000000-0000-4000-8000-000000000002",
        "FREE_WITH_A_KEY",
        "FREE",
        "'deck.europe_coats'",
      ),
    ).rejects.toThrow();
    await expect(
      deck(
        "64000000-0000-4000-8000-000000000003",
        "PAID_WITH_NO_KEY",
        "ENTITLEMENT",
        "NULL",
      ),
    ).rejects.toThrow();
  });
});
