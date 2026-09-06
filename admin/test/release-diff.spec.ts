import { describe, expect, it } from "vitest";
import {
  groupDiff,
  groupOfDeckDetail,
} from "../src/resources/drafts/release-diff";
import type { components } from "../src/api/generated/admin-api";

type DraftDiff = components["schemas"]["AdminDraftDiff"];

function diff(overrides: Partial<DraftDiff> = {}): DraftDiff {
  return {
    baseContentVersion: "2026.09.01",
    isEmpty: false,
    entities: [],
    assets: [],
    decks: [],
    ...overrides,
  };
}

describe("groupOfDeckDetail", () => {
  // A reviewer is looking for the change that takes something away, and it
  // arrives as a string on the same entry as a renamed description.
  it("separates what a purchase opens from what a deck is called", () => {
    expect(groupOfDeckDetail("Access: free → paid (deck.coats)")).toBe(
      "access",
    );
    expect(groupOfDeckDetail("Entitlement: — → deck.coats")).toBe("commerce");
    expect(groupOfDeckDetail('Name (ru): "Европа" → "Европа и Азия"')).toBe(
      "presentation",
    );
    expect(groupOfDeckDetail("Description (en) changed")).toBe("presentation");
    expect(groupOfDeckDetail("Localization added: de")).toBe("presentation");
    expect(groupOfDeckDetail("Card templates: COAT_OF_ARMS_TO_COUNTRY")).toBe(
      "template",
    );
    expect(groupOfDeckDetail("Countries: 12 → 14")).toBe("membership");
  });

  it("files a detail it does not recognise rather than dropping it", () => {
    expect(groupOfDeckDetail("Something nobody has written yet")).toBe(
      "membership",
    );
  });
});

describe("groupDiff", () => {
  it("splits one deck's changes across the groups they belong to", () => {
    const groups = groupDiff(
      diff({
        decks: [
          {
            deckKey: "deck.european_coats",
            publishedCode: "EUROPEAN_COATS",
            change: "changed",
            details: [
              "Countries: 12 → 14",
              "Access: free → paid (deck.european_coats)",
              "Card templates: COAT_OF_ARMS_TO_COUNTRY",
              "Description (en) changed",
            ],
          },
        ],
      }),
    );
    expect(groups.map((group) => group.id)).toEqual([
      "template",
      "membership",
      "presentation",
      "access",
    ]);
    expect(groups.find((group) => group.id === "access")?.lines).toEqual([
      {
        subject: "deck.european_coats",
        detail: "Access: free → paid (deck.european_coats)",
        change: "changed",
      },
    ]);
  });

  it("keeps entities and assets in groups of their own", () => {
    const groups = groupDiff(
      diff({
        entities: [
          { entityKey: "country.germany", details: ["type: country → area"] },
        ],
        assets: [
          {
            entityContentKey: "country.germany",
            assetType: "COAT_OF_ARMS",
            change: "replaced",
            reason: "The upstream drawing was wrong",
          },
        ],
      }),
    );
    expect(groups.map((group) => group.id)).toEqual(["entity", "asset"]);
    expect(groups[1]?.lines[0]).toEqual({
      subject: "country.germany · COAT_OF_ARMS",
      detail: "The upstream drawing was wrong",
      change: "replaced",
    });
  });

  it("leaves out a group nothing changed in", () => {
    expect(groupDiff(diff())).toEqual([]);
  });
});
