import { StoreEnvironment, StoreProvider } from "@prisma/client";

import { ApiException } from "../../../common/http/api.exception";
import {
  parseEntitlementCreateRequest,
  parseOfferCreateRequest,
  parseOfferUpdateRequest,
  parseStoreProductCreateRequest,
  parseStoreProductUpdateRequest,
} from "./admin-commerce.request";

function refusalOf(error: unknown): { code: string; field: string } {
  if (!(error instanceof ApiException)) {
    throw new Error(`Expected an ApiException, received ${String(error)}`);
  }
  const body = error.getResponse() as {
    error: { code: string; details: { fields?: { field: string }[] } };
  };
  return {
    code: body.error.code,
    field: body.error.details.fields?.[0]?.field ?? "",
  };
}

function refusing(parse: () => unknown): { code: string; field: string } {
  try {
    parse();
  } catch (error) {
    return refusalOf(error);
  }
  throw new Error("The request was accepted");
}

describe("admin commerce requests", () => {
  /// The whole section has one field it must never grow. Nothing in the
  /// request shapes accepts a price, so a console that tried to send one
  /// would be refused by name rather than have the value quietly ignored.
  it("refuses a price wherever it is offered", () => {
    expect(
      refusing(() =>
        parseOfferCreateRequest({
          code: "EUROPEAN_COATS_LIFETIME",
          grants: ["entitlement.european_coats"],
          price: 299,
        }),
      ),
    ).toEqual({ code: "VALIDATION_FAILED", field: "body.price" });
    expect(
      refusing(() =>
        parseStoreProductCreateRequest({
          provider: StoreProvider.APPLE_APP_STORE,
          storeEnvironment: StoreEnvironment.SANDBOX,
          bundleId: "app.countryflags.mobile.dev",
          productId: "app.countryflags.deck.european_coats.lifetime.v1",
          price: 299,
        }),
      ),
    ).toEqual({ code: "VALIDATION_FAILED", field: "body.price" });
  });

  describe("entitlement keys", () => {
    /// While an entitlement was called `deck.europe_coats` beside a deck
    /// called `deck.european_coats`, the two differed by a letter — and for
    /// the state flags they did not differ at all (§3.1).
    it("refuses a key outside the entitlement namespace", () => {
      expect(
        refusing(() =>
          parseEntitlementCreateRequest({ key: "deck.european_coats" }),
        ),
      ).toEqual({ code: "VALIDATION_FAILED", field: "key" });
    });

    it("refuses a key that is not a dotted lowercase name", () => {
      expect(
        refusing(() =>
          parseEntitlementCreateRequest({ key: "Entitlement.European" }),
        ),
      ).toEqual({ code: "VALIDATION_FAILED", field: "key" });
    });

    it("accepts a namespaced key with an optional note", () => {
      expect(
        parseEntitlementCreateRequest({
          key: "entitlement.european_coats",
          description: "Opens the European coats of arms deck",
        }),
      ).toEqual({
        key: "entitlement.european_coats",
        description: "Opens the European coats of arms deck",
      });
    });
  });

  describe("offers", () => {
    it("defaults a new offer to a one-time purchase", () => {
      expect(
        parseOfferCreateRequest({
          code: "EUROPEAN_COATS_LIFETIME",
          grants: ["entitlement.european_coats"],
        }),
      ).toEqual({
        code: "EUROPEAN_COATS_LIFETIME",
        kind: "ONE_TIME",
        grants: ["entitlement.european_coats"],
      });
    });

    it("refuses an offer that grants nothing", () => {
      expect(
        refusing(() =>
          parseOfferCreateRequest({
            code: "EUROPEAN_COATS_LIFETIME",
            grants: [],
          }),
        ),
      ).toEqual({ code: "VALIDATION_FAILED", field: "grants" });
    });

    it("refuses an update that changes nothing", () => {
      expect(refusing(() => parseOfferUpdateRequest({}))).toEqual({
        code: "VALIDATION_FAILED",
        field: "body",
      });
    });

    it("lets a note be cleared without clearing the offer", () => {
      expect(parseOfferUpdateRequest({ notes: null })).toEqual({ notes: null });
    });
  });

  describe("store products", () => {
    /// The product id, its type, its bundle and its store are what identify
    /// the thing. Editing one of them would repoint an offer at a different
    /// product without the store ever hearing about it.
    it("accepts a status change and nothing else", () => {
      expect(parseStoreProductUpdateRequest({ status: "RETIRED" })).toEqual({
        status: "RETIRED",
      });
      expect(
        refusing(() =>
          parseStoreProductUpdateRequest({
            status: "RETIRED",
            productId: "app.countryflags.deck.other.v1",
          }),
        ),
      ).toEqual({ code: "VALIDATION_FAILED", field: "body.productId" });
    });

    it("defaults a mapping to a non-consumable", () => {
      expect(
        parseStoreProductCreateRequest({
          provider: StoreProvider.APPLE_APP_STORE,
          storeEnvironment: StoreEnvironment.SANDBOX,
          bundleId: "app.countryflags.mobile.dev",
          productId: "app.countryflags.deck.european_coats.lifetime.v1",
        }).productType,
      ).toBe("NON_CONSUMABLE");
    });

    it("makes the operator name the store the product belongs to", () => {
      expect(
        refusing(() =>
          parseStoreProductCreateRequest({
            provider: StoreProvider.APPLE_APP_STORE,
            bundleId: "app.countryflags.mobile.dev",
            productId: "app.countryflags.deck.european_coats.lifetime.v1",
          }),
        ),
      ).toEqual({ code: "VALIDATION_FAILED", field: "storeEnvironment" });
    });
  });
});
