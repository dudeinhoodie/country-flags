import { HttpStatus } from "@nestjs/common";
import {
  AnswerMode,
  DeckAccessModel,
  SelectionOrigin,
  StudySessionStatus,
} from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import type { PrismaService } from "../../infrastructure/database/prisma.service";
import { DeckAccessService } from "../commerce/deck-access.service";
import type {
  CreateOfflineStudySessionRequest,
  CreateServerStudySessionRequest,
} from "./study-session.request";
import { StudySessionsService } from "./study-sessions.service";

const USER_ID = "80000000-0000-4000-8000-000000000001";
const PAID_DECK_ID = "70000000-0000-4000-8000-000000000002";
const SESSION_ID = "90000000-0000-4000-8000-000000000001";

const paidDeck = {
  id: PAID_DECK_ID,
  contentVersion: "test-only-fixture-v1",
  accessModel: DeckAccessModel.ENTITLEMENT,
  requiredEntitlementKey: "entitlement.european_coats",
};

const serverRequest: CreateServerStudySessionRequest = {
  id: SESSION_ID,
  deckId: PAID_DECK_ID,
  requestedUniqueCount: 5,
  mode: AnswerMode.SELF_RATED,
  locale: "en",
  selectionOrigin: SelectionOrigin.SERVER,
  composition: "STANDARD",
};

const offlineRequest: CreateOfflineStudySessionRequest = {
  id: SESSION_ID,
  deckId: PAID_DECK_ID,
  requestedUniqueCount: 5,
  mode: AnswerMode.SELF_RATED,
  locale: "en",
  selectionOrigin: SelectionOrigin.CLIENT_OFFLINE,
  startedAt: new Date("2026-09-01T10:00:00.000Z"),
  contentVersion: "test-only-fixture-v1",
  cards: [],
};

function storedSession(origin: SelectionOrigin): Record<string, unknown> {
  return {
    id: SESSION_ID,
    deckId: PAID_DECK_ID,
    mode: AnswerMode.SELF_RATED,
    selectionOrigin: origin,
    requestedUniqueCount: 5,
    selectedUniqueCount: 0,
    status: StudySessionStatus.ACTIVE,
    contentVersion: "test-only-fixture-v1",
    schedulerVersion: "test-fsrs-6-v2",
    startedAt: new Date("2026-09-01T10:00:00.000Z"),
    completedAt: null,
    summary: null,
    cards: [],
  };
}

describe("StudySessionsService deck access", () => {
  const studySession = {
    findUnique: jest.fn(),
    create: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  };
  const user = { findFirst: jest.fn() };
  const deck = { findFirst: jest.fn() };
  const schedulerDefinition = { findFirst: jest.fn() };
  const contentPointer = { findUnique: jest.fn() };
  const contentRelease = { findFirst: jest.fn() };
  const deckCard = { findMany: jest.fn() };
  const userSettings = { findUnique: jest.fn() };
  const userEntitlementGrant = { findFirst: jest.fn() };
  const commerceOfferGrant = { findMany: jest.fn() };
  const transaction = {
    studySession,
    user,
    deck,
    schedulerDefinition,
    contentPointer,
    contentRelease,
    deckCard,
    userSettings,
    userEntitlementGrant,
    commerceOfferGrant,
  };
  const prisma = {
    $transaction: jest.fn((run: (client: typeof transaction) => unknown) =>
      run(transaction),
    ),
    // Never reached: the guard is handed the transaction, so the answer comes
    // from the snapshot the session is built in.
    userEntitlementGrant: {
      findFirst: jest.fn(() => {
        throw new Error("Access must be read inside the session transaction");
      }),
    },
    commerceOfferGrant: { findMany: jest.fn() },
  } as unknown as PrismaService;
  const service = new StudySessionsService(
    prisma,
    new DeckAccessService(prisma),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    studySession.findUnique.mockResolvedValue(null);
    studySession.create.mockResolvedValue({});
    user.findFirst.mockResolvedValue({ id: USER_ID });
    deck.findFirst.mockResolvedValue(paidDeck);
    schedulerDefinition.findFirst.mockResolvedValue({
      version: "test-fsrs-6-v2",
    });
    contentPointer.findUnique.mockResolvedValue({
      release: { metadata: { manifest: { defaultLocale: "en" } } },
    });
    contentRelease.findFirst.mockResolvedValue({
      version: "test-only-fixture-v1",
      metadata: { manifest: { defaultLocale: "en" } },
    });
    deckCard.findMany.mockResolvedValue([]);
    userSettings.findUnique.mockResolvedValue(null);
    userEntitlementGrant.findFirst.mockResolvedValue(null);
    commerceOfferGrant.findMany.mockResolvedValue([
      {
        entitlementKey: "entitlement.european_coats",
        offer: { code: "EUROPEAN_COATS_LIFETIME", sortOrder: 10 },
      },
    ]);
  });

  it("refuses a new session on a deck the account has not bought", async () => {
    const thrown = await service
      .create(USER_ID, serverRequest)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ApiException);
    const failure = thrown as ApiException;
    expect(failure.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(failure.getResponse()).toMatchObject({
      error: {
        code: "ENTITLEMENT_REQUIRED",
        details: {
          deckId: PAID_DECK_ID,
          offerCodes: ["EUROPEAN_COATS_LIFETIME"],
        },
      },
    });
    // The deck being published was the only thing this route used to check.
    expect(studySession.create).not.toHaveBeenCalled();
    expect(deckCard.findMany).not.toHaveBeenCalled();
  });

  it("creates the session once the account holds an active grant", async () => {
    userEntitlementGrant.findFirst.mockResolvedValue({ id: "grant" });
    studySession.findUniqueOrThrow.mockResolvedValue(
      storedSession(SelectionOrigin.SERVER),
    );

    const result = await service.create(USER_ID, serverRequest);

    expect(result.created).toBe(true);
    expect(studySession.create).toHaveBeenCalledTimes(1);
    expect(userEntitlementGrant.findFirst).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        entitlementKey: "entitlement.european_coats",
        status: "ACTIVE",
      },
      select: { id: true },
    });
  });

  it("imports a session the client assembled offline without an entitlement", async () => {
    studySession.findUniqueOrThrow.mockResolvedValue(
      storedSession(SelectionOrigin.CLIENT_OFFLINE),
    );

    const result = await service.create(USER_ID, offlineRequest);

    // A refund must not delete repetitions the learner honestly did while
    // they owned the deck, so the import is not guarded — and it opens
    // nothing: no entitlement, no deck composition, no next session.
    expect(result.created).toBe(true);
    expect(studySession.create).toHaveBeenCalledTimes(1);
    expect(userEntitlementGrant.findFirst).not.toHaveBeenCalled();
  });
});
