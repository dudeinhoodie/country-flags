import { HttpStatus } from "@nestjs/common";
import {
  CommerceOfferStatus,
  DeckAccessModel,
  EntitlementGrantStatus,
} from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import type { PrismaService } from "../../infrastructure/database/prisma.service";
import {
  DeckAccessService,
  type DeckAccessReader,
  type DeckAccessSubject,
} from "./deck-access.service";

const USER_ID = "80000000-0000-4000-8000-000000000001";

const freeDeck: DeckAccessSubject = {
  id: "70000000-0000-4000-8000-000000000001",
  accessModel: DeckAccessModel.FREE,
  requiredEntitlementKey: null,
};

const paidDeck: DeckAccessSubject = {
  id: "70000000-0000-4000-8000-000000000002",
  accessModel: DeckAccessModel.ENTITLEMENT,
  requiredEntitlementKey: "entitlement.european_coats",
};

interface RefusalDetails {
  deckId: string;
  offerCodes: string[];
}

function refusalOf(error: unknown): {
  status: number;
  code: string;
  details: RefusalDetails;
} {
  if (!(error instanceof ApiException)) {
    throw new Error(`Expected an ApiException, received ${String(error)}`);
  }
  const body = error.getResponse() as {
    error: { code: string; details: RefusalDetails };
  };
  return {
    status: error.getStatus(),
    code: body.error.code,
    details: body.error.details,
  };
}

describe("DeckAccessService", () => {
  const userEntitlementGrant = { findFirst: jest.fn() };
  const commerceOfferGrant = { findMany: jest.fn() };
  const service = new DeckAccessService({
    userEntitlementGrant,
    commerceOfferGrant,
  } as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    userEntitlementGrant.findFirst.mockResolvedValue(null);
    commerceOfferGrant.findMany.mockResolvedValue([]);
  });

  it("opens a free deck to a caller with no account at all", async () => {
    await expect(service.isGranted(freeDeck, null)).resolves.toBe(true);
    await expect(
      service.requireAccess(freeDeck, null),
    ).resolves.toBeUndefined();
    expect(userEntitlementGrant.findFirst).not.toHaveBeenCalled();
  });

  it("opens a paid deck for an active grant of the required right", async () => {
    userEntitlementGrant.findFirst.mockResolvedValue({ id: "grant" });

    await expect(service.isGranted(paidDeck, USER_ID)).resolves.toBe(true);

    expect(userEntitlementGrant.findFirst).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        entitlementKey: "entitlement.european_coats",
        status: EntitlementGrantStatus.ACTIVE,
      },
      select: { id: true },
    });
  });

  it("refuses a paid deck once the only grant is revoked", async () => {
    // The revoked row is still there; the query does not match it, which is
    // the whole reason access is "at least one ACTIVE grant" rather than a
    // flag somebody has to remember to clear.
    userEntitlementGrant.findFirst.mockResolvedValue(null);

    await expect(service.isGranted(paidDeck, USER_ID)).resolves.toBe(false);
  });

  it("refuses a guest a paid deck without asking the database", async () => {
    await expect(service.isGranted(paidDeck, null)).resolves.toBe(false);
    expect(userEntitlementGrant.findFirst).not.toHaveBeenCalled();
  });

  it("refuses an entitlement deck that names no entitlement", async () => {
    // Only reachable if the check constraint were dropped; the guard fails
    // closed rather than reading a missing key as "free".
    await expect(
      service.isGranted({ ...paidDeck, requiredEntitlementKey: null }, USER_ID),
    ).resolves.toBe(false);
  });

  it("names the deck and the offers that grant it, and never a price", async () => {
    commerceOfferGrant.findMany.mockResolvedValue([
      {
        entitlementKey: "entitlement.european_coats",
        offer: { code: "SYMBOLS_BUNDLE_LIFETIME", sortOrder: 20 },
      },
      {
        entitlementKey: "entitlement.european_coats",
        offer: { code: "EUROPEAN_COATS_LIFETIME", sortOrder: 10 },
      },
    ]);

    const error = await service
      .requireAccess(paidDeck, USER_ID)
      .catch((thrown: unknown) => thrown);

    expect(refusalOf(error)).toEqual({
      status: HttpStatus.FORBIDDEN,
      code: "ENTITLEMENT_REQUIRED",
      details: {
        deckId: paidDeck.id,
        offerCodes: ["EUROPEAN_COATS_LIFETIME", "SYMBOLS_BUNDLE_LIFETIME"],
      },
    });
  });

  it("offers only what a store can still sell", async () => {
    await service.requireAccess(paidDeck, USER_ID).catch(() => undefined);

    expect(commerceOfferGrant.findMany).toHaveBeenCalledWith({
      where: {
        entitlementKey: { in: ["entitlement.european_coats"] },
        offer: { status: CommerceOfferStatus.ACTIVE },
      },
      select: {
        entitlementKey: true,
        offer: { select: { code: true, sortOrder: true } },
      },
    });
  });

  it("puts an unranked offer last rather than first", async () => {
    commerceOfferGrant.findMany.mockResolvedValue([
      {
        entitlementKey: "entitlement.european_coats",
        offer: { code: "LATE_ADDITION", sortOrder: null },
      },
      {
        entitlementKey: "entitlement.european_coats",
        offer: { code: "EUROPEAN_COATS_LIFETIME", sortOrder: 10 },
      },
    ]);

    const error = await service
      .requireAccess(paidDeck, null)
      .catch((thrown: unknown) => thrown);

    expect(refusalOf(error).details.offerCodes).toEqual([
      "EUROPEAN_COATS_LIFETIME",
      "LATE_ADDITION",
    ]);
  });

  it("describes a page of decks with one offer query", async () => {
    commerceOfferGrant.findMany.mockResolvedValue([
      {
        entitlementKey: "entitlement.european_coats",
        offer: { code: "EUROPEAN_COATS_LIFETIME", sortOrder: 10 },
      },
    ]);

    const policies = await service.policiesFor([freeDeck, paidDeck]);

    expect(commerceOfferGrant.findMany).toHaveBeenCalledTimes(1);
    expect(policies.get(freeDeck.id)).toEqual({
      model: DeckAccessModel.FREE,
    });
    expect(policies.get(paidDeck.id)).toEqual({
      model: DeckAccessModel.ENTITLEMENT,
      requiredEntitlementKey: "entitlement.european_coats",
      offerCodes: ["EUROPEAN_COATS_LIFETIME"],
    });
  });

  it("asks nothing of the database for a catalog of free decks", async () => {
    const policies = await service.policiesFor([freeDeck]);

    expect(commerceOfferGrant.findMany).not.toHaveBeenCalled();
    expect(policies.get(freeDeck.id)).toEqual({ model: DeckAccessModel.FREE });
  });

  it("reads the caller's transaction when it is given one", async () => {
    const transactional = {
      userEntitlementGrant: { findFirst: jest.fn().mockResolvedValue(null) },
      commerceOfferGrant: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as DeckAccessReader;

    await expect(
      service.isGranted(paidDeck, USER_ID, transactional),
    ).resolves.toBe(false);

    expect(userEntitlementGrant.findFirst).not.toHaveBeenCalled();
  });
});
