import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { resolveDeckMembers } from "./deck-membership";
import type { EditorialDeck, TaxonomyRelation } from "./deck-membership";

interface BuiltCatalog {
  entities: { key: string }[];
  decks: { key: string; memberEntityKeys: string[] }[];
  relations?: {
    parentKey: string;
    childKey: string;
    relationType: string;
  }[];
}

function readJson<T>(...segments: string[]): T {
  return JSON.parse(
    readFileSync(resolve(__dirname, "../../../..", ...segments), "utf8"),
  ) as T;
}

/**
 * The console resolves deck membership itself so it can preview a draft
 * before anything is built. That makes it a second implementation of a rule
 * the release build already owns, and a second implementation is only safe
 * while it agrees with the first.
 *
 * This pins it to the pipeline's real output: the committed fixture bundle
 * is what `content build` produced from the committed catalog, so resolving
 * the same catalog here has to reproduce the same deck memberships exactly.
 * If the pipeline's rules change and this code does not follow, this test
 * fails — which is the point.
 */
describe("deck resolution parity with the content pipeline", () => {
  const catalog = readJson<{
    entities: {
      key: string;
      type: string;
      status: string;
      config: { includeInCountryCatalog: boolean };
    }[];
    decks: EditorialDeck[];
    additionalRelations: {
      parentKey: string;
      childKey: string;
      relationType: string;
    }[];
  }>("tools/content-pipeline/editorial/catalog.json");

  const built = readJson<BuiltCatalog>(
    "content/generated/fixture-v1/catalog.json",
  );

  it("reproduces every published deck's membership from the same catalog", () => {
    // The built catalog carries the merged relations the build classified
    // with; the console gets the equivalent set from the active release.
    const relations: TaxonomyRelation[] = (built.relations ?? []).map(
      (relation) => ({
        parentKey: relation.parentKey,
        childKey: relation.childKey,
        relationType: relation.relationType,
      }),
    );
    expect(built.decks.length).toBeGreaterThan(0);

    for (const builtDeck of built.decks) {
      const editorial = catalog.decks.find(
        (deck) => deck.key === builtDeck.key,
      );
      expect(editorial).toBeDefined();
      const resolved = resolveDeckMembers(editorial!, {
        entities: catalog.entities,
        relations,
      });
      expect({ deck: builtDeck.key, members: resolved }).toEqual({
        deck: builtDeck.key,
        members: [...builtDeck.memberEntityKeys].sort(),
      });
    }
  });
});
