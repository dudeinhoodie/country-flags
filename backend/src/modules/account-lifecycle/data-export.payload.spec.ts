import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Prisma } from "@prisma/client";
import type { ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import {
  buildDataExportPayload,
  DATA_EXPORT_SCHEMA_VERSION,
  type DataExportUserRecord,
} from "./data-export.payload";

const USER_ID = "0f6f2c1e-3a51-4c7e-9a86-3f0a5b8c1d01";
const DECK_ID = "70000000-0000-4000-8000-000000000001";
const CARD_ID = "71000000-0000-4000-8000-000000000001";
const SESSION_ID = "a2000000-0000-4000-8000-000000000001";
const SYNC_STREAM_ID = "5c1e0000-0000-4000-8000-00000000c0de";
const STORE_ACCOUNT_TOKEN = "6d7e0000-0000-4000-8000-0000000000aa";
const PAYLOAD_HASH = "f".repeat(64);
const APPLE_SUBJECT = "001234.5f0c1e2d3b4a49c8a7e6d5c4b3a29180.1207";
const MIGRATION_ID = "a1000000-0000-4000-8000-000000000001";

/** The published contract, read from contracts rather than mirrored. */
function contractValidator(): {
  validate: ValidateFunction;
  schemaVersion: unknown;
} {
  const schema = JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        "../../../../contracts/schemas/account/data-export.v2.schema.json",
      ),
      "utf8",
    ),
  ) as { properties: { schemaVersion: { const: unknown } } };
  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strict: true,
  });
  addFormats(ajv);
  return {
    validate: ajv.compile(schema),
    schemaVersion: schema.properties.schemaVersion.const,
  };
}

function at(value: string): Date {
  return new Date(value);
}

function populatedRecord(): DataExportUserRecord {
  return {
    id: USER_ID,
    syncStreamId: SYNC_STREAM_ID,
    storeAccountToken: STORE_ACCOUNT_TOKEN,
    displayName: "Flags Learner",
    preferredLocale: "en-US",
    status: "ACTIVE",
    createdAt: at("2026-07-29T12:00:00.000Z"),
    updatedAt: at("2026-09-20T08:00:00.000Z"),
    deletionRequestedAt: null,
    deletedAt: null,
    settings: {
      userId: USER_ID,
      sessionSize: 20,
      contentLocale: "en-US",
      defaultAnswerMode: "SELF_RATED",
      extraFactTypes: ["CAPITAL"],
      soundEnabled: true,
      hapticsEnabled: true,
      remindersEnabled: true,
      reminderLocalTime: at("1970-01-01T19:30:00.000Z"),
      reminderWeekdays: [1, 3, 5],
      desiredRetention: new Prisma.Decimal("0.900"),
      timezone: "Europe/Berlin",
      version: 3,
      updatedAt: at("2026-09-20T08:00:00.000Z"),
    },
    privacySettings: {
      userId: USER_ID,
      productAnalyticsStatus: "GRANTED",
      diagnosticsStatus: "DENIED",
      policyVersion: "privacy-policy-v1",
      version: 3,
      updatedAt: at("2026-09-01T09:00:00.000Z"),
    },
    privacyEvents: [
      {
        category: "PRODUCT_ANALYTICS",
        previousStatus: "UNKNOWN",
        newStatus: "GRANTED",
        policyVersion: "privacy-policy-v1",
        source: "WEB",
        occurredAt: at("2026-08-01T09:00:00.000Z"),
      },
      {
        category: "DIAGNOSTICS",
        previousStatus: "UNKNOWN",
        newStatus: "DENIED",
        policyVersion: "privacy-policy-v1",
        source: "IOS",
        occurredAt: at("2026-09-01T09:00:00.000Z"),
      },
    ],
    authIdentities: [
      {
        provider: "APPLE",
        providerSubject: APPLE_SUBJECT,
        email: "a1b2c3d4e5@privaterelay.appleid.com",
        emailVerified: true,
        isPrivateEmail: true,
        createdAt: at("2026-07-29T12:00:00.000Z"),
        lastLoginAt: at("2026-09-20T07:59:00.000Z"),
      },
      {
        provider: "GOOGLE",
        providerSubject: "109876543210987654321",
        email: null,
        emailVerified: null,
        isPrivateEmail: null,
        createdAt: at("2026-08-02T10:00:00.000Z"),
        lastLoginAt: at("2026-08-02T10:00:00.000Z"),
      },
    ],
    devices: [
      {
        platform: "IOS",
        appVersion: "1.0.0",
        locale: "en-US",
        timezone: "Europe/Berlin",
        createdAt: at("2026-07-29T12:00:00.000Z"),
        lastSeenAt: at("2026-09-20T07:59:00.000Z"),
        deletedAt: null,
      },
      {
        platform: "IOS",
        appVersion: "0.9.0",
        locale: "en-US",
        timezone: "Europe/Berlin",
        createdAt: at("2026-07-01T12:00:00.000Z"),
        lastSeenAt: at("2026-07-28T18:00:00.000Z"),
        deletedAt: at("2026-07-29T12:05:00.000Z"),
      },
    ],
    refreshSessions: [
      {
        createdAt: at("2026-07-29T12:00:00.000Z"),
        lastUsedAt: at("2026-08-05T08:00:00.000Z"),
        expiresAt: at("2026-08-28T12:00:00.000Z"),
        revokedAt: at("2026-08-05T08:00:00.000Z"),
        userAgent: "Vexi/1.0.0 (iPhone; iOS 26.0)",
      },
      {
        createdAt: at("2026-08-05T08:00:00.000Z"),
        lastUsedAt: at("2026-09-20T07:59:00.000Z"),
        expiresAt: at("2026-10-20T07:59:00.000Z"),
        revokedAt: null,
        userAgent: null,
      },
    ],
    guestImports: [
      {
        id: MIGRATION_ID,
        status: "APPLIED",
        acceptedEventCount: 42,
        duplicateEventCount: 0,
        rejectedEventCount: 0,
        createdAt: at("2026-07-29T12:00:05.000Z"),
        completedAt: at("2026-07-29T12:00:09.000Z"),
      },
    ],
    studySessions: [
      {
        id: SESSION_ID,
        deckId: DECK_ID,
        deck: { code: "EUROPE_FLAGS" },
        mode: "SELF_RATED",
        selectionOrigin: "SERVER",
        requestedUniqueCount: 10,
        selectedUniqueCount: 1,
        status: "COMPLETED",
        contentVersion: "2026.09.01",
        schedulerVersion: "fsrs-6-v1",
        startedAt: at("2026-09-20T07:50:00.000Z"),
        completedAt: at("2026-09-20T07:55:00.000Z"),
        summary: {
          uniqueCardCount: 1,
          reviewCount: 1,
          correctCount: 1,
          incorrectCount: 0,
          durationSeconds: 300,
          ratings: { again: 0, hard: 0, good: 1, easy: 0 },
        },
        cards: [
          {
            learningCardId: CARD_ID,
            initialOrder: 0,
            selectionReason: "NEW",
          },
        ],
      },
      {
        id: "a2000000-0000-4000-8000-000000000002",
        deckId: DECK_ID,
        deck: { code: "EUROPE_FLAGS" },
        mode: "MULTIPLE_CHOICE",
        selectionOrigin: "CLIENT_OFFLINE",
        requestedUniqueCount: 5,
        selectedUniqueCount: 0,
        status: "ACTIVE",
        contentVersion: "2026.09.01",
        schedulerVersion: "fsrs-6-v1",
        startedAt: at("2026-09-21T07:50:00.000Z"),
        completedAt: null,
        summary: null,
        cards: [],
      },
    ],
    reviewEvents: [
      {
        id: "a3000000-0000-4000-8000-000000000001",
        userId: USER_ID,
        learningCardId: CARD_ID,
        sessionId: SESSION_ID,
        deviceId: null,
        rating: "GOOD",
        isCorrect: true,
        answerMode: "SELF_RATED",
        selectedOptionId: null,
        responseTimeMs: 2500,
        clientOccurredAt: at("2026-09-20T07:51:00.000Z"),
        estimatedServerOccurredAt: null,
        effectiveOccurredAt: at("2026-09-20T07:51:00.000Z"),
        receivedAt: at("2026-09-20T07:55:01.000Z"),
        clientSequence: 1n,
        timeConfidence: "CALIBRATED",
        baseStateVersion: null,
        schedulerVersion: "fsrs-6-v1",
        schedulerParametersVersion: "fsrs-6-default-v1",
        payloadVersion: 1,
        payloadHash: PAYLOAD_HASH,
        metadata: {},
      },
    ],
    cardStates: [
      {
        userId: USER_ID,
        learningCardId: CARD_ID,
        state: "LEARNING",
        difficulty: new Prisma.Decimal("5.200000"),
        stability: new Prisma.Decimal("0.400000"),
        retrievabilityAtReview: null,
        dueAt: at("2026-09-20T10:51:00.000Z"),
        lastReviewedAt: at("2026-09-20T07:51:00.000Z"),
        repetitions: 1,
        lapses: 0,
        learningStep: 1,
        schedulerVersion: "fsrs-6-v1",
        schedulerParametersVersion: "fsrs-6-default-v1",
        stateVersion: 2,
        updatedAt: at("2026-09-20T07:55:01.000Z"),
      },
    ],
    deckMastery: [
      {
        userId: USER_ID,
        deckId: DECK_ID,
        deck: { code: "EUROPE_FLAGS" },
        tier: "BRONZE",
        masteredCardCount: 12,
        totalCardCount: 44,
        projectionVersion: 1,
        updatedAt: at("2026-09-20T07:55:01.000Z"),
      },
    ],
    achievements: [
      {
        id: "a4000000-0000-4000-8000-000000000001",
        userId: USER_ID,
        definitionId: "a5000000-0000-4000-8000-000000000001",
        definition: { code: "deck_bronze" },
        scopeType: "DECK",
        scopeId: DECK_ID,
        earnedAt: at("2026-09-20T07:55:01.000Z"),
        ruleVersion: 1,
        evidence: { learnedCards: 12 },
      },
    ],
    storeTransactions: [
      {
        provider: "APPLE_APP_STORE",
        storeEnvironment: "PRODUCTION",
        transactionId: "2000000912345678",
        originalTransactionId: "2000000912345678",
        productId: "app.vexi.deck.europe_coats",
        ownershipType: "PURCHASED",
        claimState: "CLAIMED",
        purchasedAt: at("2026-09-04T12:20:00.000Z"),
        verifiedAt: at("2026-09-04T12:20:01.000Z"),
        revokedAt: null,
        revocationReason: null,
      },
    ],
    entitlementGrants: [
      {
        entitlementKey: "entitlement.europe_coats",
        sourceType: "STORE_TRANSACTION",
        status: "ACTIVE",
        grantedAt: at("2026-09-04T12:20:01.000Z"),
        revokedAt: null,
        revocationReason: null,
        sourceTransaction: { transactionId: "2000000912345678" },
      },
      {
        entitlementKey: "entitlement.african_flags",
        sourceType: "MIGRATION",
        status: "REVOKED",
        grantedAt: at("2026-08-04T12:20:01.000Z"),
        revokedAt: at("2026-08-05T12:20:01.000Z"),
        revocationReason: "superseded",
        sourceTransaction: null,
      },
    ],
  };
}

function sparseRecord(): DataExportUserRecord {
  return {
    ...populatedRecord(),
    displayName: null,
    settings: null,
    privacySettings: null,
    privacyEvents: [],
    devices: [],
    refreshSessions: [],
    guestImports: [],
    studySessions: [],
    reviewEvents: [],
    cardStates: [],
    deckMastery: [],
    achievements: [],
    storeTransactions: [],
    entitlementGrants: [],
  };
}

describe("buildDataExportPayload", () => {
  const { validate, schemaVersion } = contractValidator();
  const generatedAt = at("2026-09-24T10:00:00.000Z");

  it("writes the version the published schema declares", () => {
    expect(DATA_EXPORT_SCHEMA_VERSION).toBe(schemaVersion);
  });

  it("matches the published contract for a fully populated account", () => {
    const payload = buildDataExportPayload(populatedRecord(), generatedAt);

    expect(validate(payload)).toBe(true);
    expect(validate.errors ?? []).toEqual([]);
  });

  it("matches the published contract for an account with nothing stored yet", () => {
    const payload = buildDataExportPayload(sparseRecord(), generatedAt);

    expect(validate(payload)).toBe(true);
    expect(validate.errors ?? []).toEqual([]);
  });

  it("is checked against a contract that rejects what it does not describe", () => {
    const payload = buildDataExportPayload(populatedRecord(), generatedAt);
    const [identity] = payload.authenticationProviders as Array<
      Record<string, unknown>
    >;

    expect(
      validate({
        ...payload,
        authenticationProviders: [{ ...identity, tokenHash: "a".repeat(64) }],
      }),
    ).toBe(false);
    expect(validate({ ...payload, schemaVersion: 1 })).toBe(false);
  });

  it("carries every section the privacy policy says an account keeps", () => {
    const payload = buildDataExportPayload(populatedRecord(), generatedAt);

    expect(payload).toMatchObject({
      schemaVersion: 2,
      authenticationProviders: [
        {
          provider: "APPLE",
          providerSubject: APPLE_SUBJECT,
          email: "a1b2c3d4e5@privaterelay.appleid.com",
          isPrivateEmail: true,
          lastSignedInAt: "2026-09-20T07:59:00.000Z",
        },
        { provider: "GOOGLE", email: null },
      ],
      devices: [
        { appVersion: "1.0.0", removedAt: null },
        { appVersion: "0.9.0", removedAt: "2026-07-29T12:05:00.000Z" },
      ],
      signInSessions: [
        {
          createdAt: "2026-07-29T12:00:00.000Z",
          revokedAt: "2026-08-05T08:00:00.000Z",
          userAgent: "Vexi/1.0.0 (iPhone; iOS 26.0)",
        },
        { revokedAt: null, userAgent: null },
      ],
      guestImports: [
        {
          migrationId: MIGRATION_ID,
          status: "APPLIED",
          acceptedEventCount: 42,
          completedAt: "2026-07-29T12:00:09.000Z",
        },
      ],
      privacySettings: {
        productAnalyticsStatus: "GRANTED",
        diagnosticsStatus: "DENIED",
      },
      consentHistory: [
        { category: "PRODUCT_ANALYTICS", newStatus: "GRANTED" },
        { category: "DIAGNOSTICS", newStatus: "DENIED", source: "IOS" },
      ],
      studySessions: [
        {
          id: SESSION_ID,
          deckCode: "EUROPE_FLAGS",
          status: "COMPLETED",
          summary: { reviewCount: 1 },
          cards: [{ learningCardId: CARD_ID, selectionReason: "NEW" }],
        },
        { status: "ACTIVE", completedAt: null, summary: null, cards: [] },
      ],
      deckMastery: [
        {
          deckId: DECK_ID,
          deckCode: "EUROPE_FLAGS",
          tier: "BRONZE",
          masteredCardCount: 12,
          totalCardCount: 44,
        },
      ],
      purchases: [
        {
          transactionId: "2000000912345678",
          productId: "app.vexi.deck.europe_coats",
          claimState: "CLAIMED",
        },
      ],
      entitlementGrants: [
        {
          entitlementKey: "entitlement.europe_coats",
          sourceTransactionId: "2000000912345678",
        },
        {
          entitlementKey: "entitlement.african_flags",
          sourceTransactionId: null,
        },
      ],
    });
  });

  it("leaves out internal replay, sync and purchase-binding material", () => {
    const serialized = JSON.stringify(
      buildDataExportPayload(populatedRecord(), generatedAt),
    );

    expect(serialized).not.toContain(PAYLOAD_HASH);
    expect(serialized).not.toContain(SYNC_STREAM_ID);
    expect(serialized).not.toContain(STORE_ACCOUNT_TOKEN);
  });
});
