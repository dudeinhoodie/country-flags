import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cardsUnder } from "./progress.service";

/**
 * A region's progress is counted over every card the classification places
 * under it, however deep. The walk used to stop at the region's own
 * children — which are subregions, carrying no cards of their own — so every
 * region scored zero and no region achievement was ever granted (#252).
 */
describe("cardsUnder", () => {
  const children = new Map<string, string[]>([
    ["region.europe", ["subregion.western", "subregion.northern"]],
    ["subregion.western", ["country.france"]],
    ["subregion.northern", ["country.norway", "country.sweden"]],
  ]);
  const cards = new Map<string, string[]>([
    ["country.france", ["card.france"]],
    ["country.norway", ["card.norway"]],
    ["country.sweden", ["card.sweden"]],
  ]);

  it("reaches the countries below the subregions", () => {
    expect(cardsUnder("region.europe", children, cards).sort()).toEqual([
      "card.france",
      "card.norway",
      "card.sweden",
    ]);
  });

  it("counts nothing for the root itself", () => {
    const withRootCard = new Map(cards);
    withRootCard.set("region.europe", ["card.europe"]);
    expect(cardsUnder("region.europe", children, withRootCard)).not.toContain(
      "card.europe",
    );
  });

  it("terminates on a cycle rather than hanging the request", () => {
    const looped = new Map(children);
    looped.set("country.france", ["region.europe"]);
    expect(cardsUnder("region.europe", looped, cards).sort()).toEqual([
      "card.france",
      "card.norway",
      "card.sweden",
    ]);
  });

  it("answers empty for a node the catalogue classifies nothing under", () => {
    expect(cardsUnder("region.atlantis", children, cards)).toEqual([]);
  });
});

/**
 * The same tree is read by the content pipeline when it resolves a taxonomy
 * deck, and by this service when it counts a region. They must agree — the
 * one-level walk disagreed silently, which is exactly the kind of drift a
 * fixture-backed test catches.
 */
describe("region membership against the published catalog", () => {
  interface BuiltCatalog {
    entities: { key: string; type: string }[];
    relations: { parentKey: string; childKey: string; relationType: string }[];
    decks: { key: string; memberEntityKeys: string[] }[];
  }

  const catalog = JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        "../../../../content/generated/fixture-v1/catalog.json",
      ),
      "utf8",
    ),
  ) as BuiltCatalog;

  const children = new Map<string, string[]>();
  for (const relation of catalog.relations) {
    if (relation.relationType !== "contains") {
      continue;
    }
    const siblings = children.get(relation.parentKey) ?? [];
    siblings.push(relation.childKey);
    children.set(relation.parentKey, siblings);
  }
  // One card per learnable entity, which is what the release publishes.
  const cards = new Map<string, string[]>(
    catalog.entities
      .filter(
        (entity) => entity.type !== "region" && entity.type !== "subregion",
      )
      .map((entity) => [entity.key, [`card.${entity.key}`]]),
  );

  it("finds the countries of every published region", () => {
    const regions = catalog.entities.filter(
      (entity) => entity.type === "region",
    );
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      // The bug this pins: with a one-level walk each of these was empty,
      // because a region's children are subregions.
      expect(cardsUnder(region.key, children, cards).length).toBeGreaterThan(0);
    }
  });

  it("agrees with the taxonomy deck the pipeline built from the same node", () => {
    for (const deck of catalog.decks) {
      const root = deck.key.replace(/^deck\./, "region.");
      if (!children.has(root)) {
        continue;
      }
      const walked = new Set(
        cardsUnder(root, children, cards).map((card) =>
          card.replace(/^card\./, ""),
        ),
      );
      // Every member the pipeline put in the deck is reachable from the
      // same node here. The deck may hold fewer — the listing toggle
      // narrows it — but never more.
      for (const member of deck.memberEntityKeys) {
        expect(walked.has(member)).toBe(true);
      }
    }
  });
});
