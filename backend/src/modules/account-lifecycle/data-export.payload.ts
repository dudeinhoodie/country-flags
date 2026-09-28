import { MasteryTier, type Prisma } from "@prisma/client";

import { serializeSettings } from "../settings/settings.service";
import { serializePrivacySettings } from "./privacy-settings.service";

/**
 * The archive format version. It is the `const` of
 * `contracts/schemas/account/data-export.v2.schema.json`; a change to the
 * shape below goes with a new schema version, not an edit of that one.
 */
export const DATA_EXPORT_SCHEMA_VERSION = 2;

/**
 * Everything the account stores about the person, read in one query.
 *
 * Selections are explicit wherever a table also holds something that is not
 * the person's to receive: token hashes and keyed address or payload hashes
 * tell the reader nothing they could check, and would only widen what a
 * leaked archive exposes.
 */
export const DATA_EXPORT_USER_INCLUDE = {
  settings: true,
  privacySettings: true,
  privacyEvents: {
    select: {
      category: true,
      previousStatus: true,
      newStatus: true,
      policyVersion: true,
      source: true,
      occurredAt: true,
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  },
  authIdentities: {
    select: {
      provider: true,
      providerSubject: true,
      email: true,
      emailVerified: true,
      isPrivateEmail: true,
      createdAt: true,
      lastLoginAt: true,
    },
    orderBy: { provider: "asc" },
  },
  devices: {
    select: {
      platform: true,
      appVersion: true,
      locale: true,
      timezone: true,
      createdAt: true,
      lastSeenAt: true,
      deletedAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  // The policy says a sign-in session record is kept, with the User-Agent
  // string, until the account is deleted. The keyed hash of the address and
  // the refresh token hash stay out: neither can be read back into anything.
  refreshSessions: {
    select: {
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      userAgent: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  // The install identifier is kept only as a keyed hash, which is left out
  // for the same reason.
  guestImports: {
    select: {
      id: true,
      status: true,
      acceptedEventCount: true,
      duplicateEventCount: true,
      rejectedEventCount: true,
      createdAt: true,
      completedAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  studySessions: {
    select: {
      id: true,
      deckId: true,
      deck: { select: { code: true } },
      mode: true,
      selectionOrigin: true,
      requestedUniqueCount: true,
      selectedUniqueCount: true,
      status: true,
      contentVersion: true,
      schedulerVersion: true,
      startedAt: true,
      completedAt: true,
      summary: true,
      cards: {
        select: {
          learningCardId: true,
          initialOrder: true,
          selectionReason: true,
        },
        orderBy: { initialOrder: "asc" },
      },
    },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
  },
  reviewEvents: {
    orderBy: [
      { effectiveOccurredAt: "asc" },
      { receivedAt: "asc" },
      { id: "asc" },
    ],
  },
  cardStates: {
    orderBy: { learningCardId: "asc" },
  },
  achievements: {
    include: {
      definition: { select: { code: true } },
    },
    orderBy: { earnedAt: "asc" },
  },
  storeTransactions: {
    select: {
      provider: true,
      storeEnvironment: true,
      transactionId: true,
      originalTransactionId: true,
      productId: true,
      ownershipType: true,
      claimState: true,
      purchasedAt: true,
      verifiedAt: true,
      revokedAt: true,
      revocationReason: true,
    },
    orderBy: [{ purchasedAt: "asc" }, { id: "asc" }],
  },
  entitlementGrants: {
    select: {
      entitlementKey: true,
      sourceType: true,
      status: true,
      grantedAt: true,
      revokedAt: true,
      revocationReason: true,
      sourceTransaction: { select: { transactionId: true } },
    },
    orderBy: [{ grantedAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.UserInclude;

export type DataExportUserRecord = Prisma.UserGetPayload<{
  include: typeof DATA_EXPORT_USER_INCLUDE;
}>;

/**
 * One deck's mastery exactly as the progress endpoints answer it, and so as
 * the app shows it.
 *
 * Not the `user_deck_mastery` rows: that table is a cache the write paths
 * refresh, and a read of it can lag what the review history now says. The
 * figures come from `ProgressService`, the one definition of mastery.
 */
export interface DeckMasteryFigures {
  deckId: string;
  deckCode: string;
  tier: MasteryTier;
  masteredCardCount: number;
  totalCardCount: number;
  ruleVersion: number;
  computedAt: Date;
}

function field<T>(
  deck: Record<string, unknown>,
  name: string,
  accepts: (value: unknown) => value is T,
): T {
  const value = deck[name];
  if (!accepts(value)) {
    throw new Error(`Deck progress has no usable "${name}"`);
  }
  return value;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
const isTier = (value: unknown): value is MasteryTier =>
  typeof value === "string" &&
  (Object.values(MasteryTier) as string[]).includes(value);

/**
 * Reads the deck entries of a progress answer (`ProgressService.getProgress`
 * → `decks`). The answer is typed loosely because it goes straight to JSON;
 * a field that changed shape fails the export loudly instead of writing a
 * wrong figure into somebody's copy of their data.
 */
export function deckMasteryFromProgress(
  decks: readonly Record<string, unknown>[],
  deckCodes: ReadonlyMap<string, string>,
): DeckMasteryFigures[] {
  return decks
    .map((deck) => {
      const deckId = field(deck, "deckId", isString);
      const deckCode = deckCodes.get(deckId);
      if (deckCode === undefined) {
        throw new Error(`Deck ${deckId} in the progress answer has no code`);
      }
      return {
        deckId,
        deckCode,
        tier: field(deck, "currentMasteryTier", isTier),
        masteredCardCount: field(deck, "learnedCards", isCount),
        totalCardCount: field(deck, "totalCards", isCount),
        ruleVersion: field(deck, "ruleVersion", isCount),
        computedAt: new Date(field(deck, "updatedAt", isString)),
      };
    })
    .sort((left, right) => left.deckId.localeCompare(right.deckId));
}

function iso(value: Date): string {
  return value.toISOString();
}

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function buildDataExportPayload(
  user: DataExportUserRecord,
  deckMastery: readonly DeckMasteryFigures[],
  generatedAt: Date,
): Record<string, unknown> {
  return {
    schemaVersion: DATA_EXPORT_SCHEMA_VERSION,
    generatedAt: iso(generatedAt),
    profile: {
      id: user.id,
      displayName: user.displayName,
      preferredLocale: user.preferredLocale,
      createdAt: iso(user.createdAt),
      updatedAt: iso(user.updatedAt),
    },
    settings: user.settings === null ? null : serializeSettings(user.settings),
    privacySettings:
      user.privacySettings === null
        ? null
        : serializePrivacySettings(user.privacySettings),
    consentHistory: user.privacyEvents.map((event) => ({
      category: event.category,
      previousStatus: event.previousStatus,
      newStatus: event.newStatus,
      policyVersion: event.policyVersion,
      source: event.source,
      occurredAt: iso(event.occurredAt),
    })),
    // The policy names both the identifier the provider assigns and the
    // address it reports as kept with the sign-in record, so the copy carries
    // both.
    authenticationProviders: user.authIdentities.map((identity) => ({
      provider: identity.provider,
      providerSubject: identity.providerSubject,
      email: identity.email,
      emailVerified: identity.emailVerified,
      isPrivateEmail: identity.isPrivateEmail,
      linkedAt: iso(identity.createdAt),
      lastSignedInAt: iso(identity.lastLoginAt),
    })),
    devices: user.devices.map((device) => ({
      platform: device.platform,
      appVersion: device.appVersion,
      locale: device.locale,
      timezone: device.timezone,
      createdAt: iso(device.createdAt),
      lastSeenAt: iso(device.lastSeenAt),
      // A removed device keeps its row because reviews reference it, so it
      // is still something the account stores.
      removedAt: isoOrNull(device.deletedAt),
    })),
    signInSessions: user.refreshSessions.map((session) => ({
      createdAt: iso(session.createdAt),
      lastUsedAt: iso(session.lastUsedAt),
      expiresAt: iso(session.expiresAt),
      revokedAt: isoOrNull(session.revokedAt),
      userAgent: session.userAgent,
    })),
    guestImports: user.guestImports.map((operation) => ({
      migrationId: operation.id,
      status: operation.status,
      acceptedEventCount: operation.acceptedEventCount,
      duplicateEventCount: operation.duplicateEventCount,
      rejectedEventCount: operation.rejectedEventCount,
      createdAt: iso(operation.createdAt),
      completedAt: isoOrNull(operation.completedAt),
    })),
    studySessions: user.studySessions.map((session) => ({
      id: session.id,
      deckId: session.deckId,
      deckCode: session.deck.code,
      mode: session.mode,
      selectionOrigin: session.selectionOrigin,
      requestedUniqueCount: session.requestedUniqueCount,
      selectedUniqueCount: session.selectedUniqueCount,
      status: session.status,
      contentVersion: session.contentVersion,
      schedulerVersion: session.schedulerVersion,
      startedAt: iso(session.startedAt),
      completedAt: isoOrNull(session.completedAt),
      summary: session.summary ?? null,
      cards: session.cards.map((card) => ({
        learningCardId: card.learningCardId,
        initialOrder: card.initialOrder,
        selectionReason: card.selectionReason,
      })),
    })),
    reviews: user.reviewEvents.map((review) => ({
      id: review.id,
      learningCardId: review.learningCardId,
      sessionId: review.sessionId,
      rating: review.rating,
      isCorrect: review.isCorrect,
      answerMode: review.answerMode,
      responseTimeMs: review.responseTimeMs,
      clientOccurredAt: iso(review.clientOccurredAt),
      effectiveOccurredAt: iso(review.effectiveOccurredAt),
      receivedAt: iso(review.receivedAt),
      clientSequence: review.clientSequence.toString(),
      schedulerVersion: review.schedulerVersion,
      schedulerParametersVersion: review.schedulerParametersVersion,
    })),
    progress: user.cardStates.map((state) => ({
      learningCardId: state.learningCardId,
      state: state.state,
      difficulty: Number(state.difficulty),
      stability: Number(state.stability),
      dueAt: iso(state.dueAt),
      lastReviewedAt: isoOrNull(state.lastReviewedAt),
      repetitions: state.repetitions,
      lapses: state.lapses,
      learningStep: state.learningStep,
      stateVersion: state.stateVersion,
      schedulerVersion: state.schedulerVersion,
      schedulerParametersVersion: state.schedulerParametersVersion,
    })),
    // What the progress endpoints answer, not the cached rows: see
    // `DeckMasteryFigures`.
    deckMastery: deckMastery.map((mastery) => ({
      deckId: mastery.deckId,
      deckCode: mastery.deckCode,
      tier: mastery.tier,
      masteredCardCount: mastery.masteredCardCount,
      totalCardCount: mastery.totalCardCount,
      ruleVersion: mastery.ruleVersion,
      computedAt: iso(mastery.computedAt),
    })),
    achievements: user.achievements.map((achievement) => ({
      code: achievement.definition.code,
      scopeType: achievement.scopeType,
      scopeId: achievement.scopeId,
      earnedAt: iso(achievement.earnedAt),
      ruleVersion: achievement.ruleVersion,
      evidence: achievement.evidence,
    })),
    purchases: user.storeTransactions.map((transaction) => ({
      provider: transaction.provider,
      storeEnvironment: transaction.storeEnvironment,
      transactionId: transaction.transactionId,
      originalTransactionId: transaction.originalTransactionId,
      productId: transaction.productId,
      ownershipType: transaction.ownershipType,
      claimState: transaction.claimState,
      purchasedAt: iso(transaction.purchasedAt),
      verifiedAt: iso(transaction.verifiedAt),
      revokedAt: isoOrNull(transaction.revokedAt),
      revocationReason: transaction.revocationReason,
    })),
    // Referenced by the store's transaction identifier, which the person can
    // match against their receipts and against `purchases`, rather than by
    // our internal row id.
    entitlementGrants: user.entitlementGrants.map((grant) => ({
      entitlementKey: grant.entitlementKey,
      sourceType: grant.sourceType,
      sourceTransactionId: grant.sourceTransaction?.transactionId ?? null,
      status: grant.status,
      grantedAt: iso(grant.grantedAt),
      revokedAt: isoOrNull(grant.revokedAt),
      revocationReason: grant.revocationReason,
    })),
  };
}
