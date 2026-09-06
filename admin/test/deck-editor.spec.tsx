import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-admin", () => ({
  Title: () => null,
  usePermissions: () => ({ permissions: "EDITOR" }),
}));

import { ApiClientProvider } from "../src/api/ApiClientContext";
import { createAdminApiClient } from "../src/api/client";
import { RuntimeConfigProvider } from "../src/config/RuntimeConfigContext";
import type { RuntimeConfig } from "../src/config/runtime-config";
import {
  cardIdentity,
  deckCodeFromKey,
  entitlementKeyProblem,
  refsToMembers,
} from "../src/resources/drafts/deck-cards";
import { DeckEditor } from "../src/resources/drafts/DeckEditor";
import type {
  DraftDeckDetail,
  DraftEntityListItem,
} from "../src/resources/drafts/useDraftDecks";

const DRAFT_ID = "5b1b1c1e-0000-4000-8000-000000000001";

const config: RuntimeConfig = {
  environment: "dev",
  apiBasePath: "/api",
  googleClientId: "",
  appVersion: "abc1234",
};

function listItem(
  fixture: Partial<DraftEntityListItem> & { key: string; type: string },
): DraftEntityListItem {
  return {
    status: "active",
    includeInCountryCatalog: true,
    recognitionStatus: "un_member",
    identifiers: {},
    parentKey: null,
    hasFlag: true,
    hasCoatOfArms: false,
    overrideCount: 0,
    publishedName: fixture.key,
    locales: { required: [], present: [], missing: [], complete: true },
    usedInDeckCount: 0,
    delivery: "PUBLIC",
    blockingCount: 0,
    warningCount: 0,
    ...fixture,
  };
}

const GERMANY = listItem({
  key: "country.germany",
  type: "country",
  publishedName: "Germany",
  hasCoatOfArms: true,
});
const FRANCE = listItem({
  key: "country.france",
  type: "country",
  publishedName: "France",
});
const CALIFORNIA = listItem({
  key: "subdivision.us.california",
  type: "subdivision",
  parentKey: "country.united_states",
  publishedName: "California",
  includeInCountryCatalog: false,
});
const TEXAS = listItem({
  key: "subdivision.us.texas",
  type: "subdivision",
  parentKey: "country.united_states",
  publishedName: "Texas",
  includeInCountryCatalog: false,
});
// Its key does not name the country, so only `parentKey` can place it.
const OHIO = listItem({
  key: "subdivision.usa.ohio",
  type: "subdivision",
  parentKey: "country.united_states",
  publishedName: "Ohio",
  includeInCountryCatalog: false,
});
const ENTITIES = [GERMANY, FRANCE, CALIFORNIA, TEXAS, OHIO];

/**
 * The read-only access summary the detail read carries beside the deck. The
 * console shows it; the commerce facts in it come from the server.
 */
function access(
  overrides: Partial<DraftDeckDetail["access"]> = {},
): DraftDeckDetail["access"] {
  return {
    model: "FREE",
    requiredEntitlementKey: null,
    published: null,
    entitlementKnown: false,
    offerCodes: [],
    storeProducts: [],
    sellable: true,
    ...overrides,
  };
}

function deckDetail(overrides: Partial<DraftDeckDetail> = {}): DraftDeckDetail {
  return {
    key: "deck.symbols-sampler",
    kind: "curated",
    names: {
      ru: { name: "Символы", description: "Оба символа" },
      en: { name: "Symbols", description: "Both symbols" },
    },
    membersMode: "explicit",
    members: ["country.germany"],
    memberCount: 1,
    defaultTemplateCode: "FLAG_TO_COUNTRY",
    defaultTemplateSchemaVersion: 1,
    previewCardIds: [],
    memberKeys: ["country.germany"],
    resolvedMemberCards: [],
    previewCards: [],
    summary: {
      cardCount: 1,
      templateCodes: ["FLAG_TO_COUNTRY"],
      missingAssetCount: 0,
      locales: { required: [], present: [], missing: [], complete: true },
      previewCardCount: 0,
      delivery: { public: 1, publicPreview: 0, paidOnly: 0 },
      blocking: 0,
      warnings: 0,
    },
    access: access(),
    validation: { blocking: 0, warnings: 0, findings: [] },
    draftRevision: 1,
    ...overrides,
  };
}

interface Stub {
  sent: () => Record<string, unknown> | null;
}

/**
 * The console talks to the real generated client; only the network is a
 * stub, so what the editor sends is what the backend would receive.
 */
function stubApi(
  deck: DraftDeckDetail,
  options: { publishedDecks?: unknown[]; commerce?: boolean } = {},
): Stub {
  let sent: Record<string, unknown> | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const url = request.url;
      const method = request.method.toUpperCase();
      const json = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      if (method === "PATCH" || method === "POST") {
        sent = JSON.parse(await request.text()) as Record<string, unknown>;
        return json({
          draftId: DRAFT_ID,
          revision: 8,
          status: "DRAFT",
          updatedAt: "2026-09-05T10:00:00Z",
        });
      }
      if (url.includes("/commerce/")) {
        if (options.commerce !== true) {
          return json({ error: { code: "RESOURCE_NOT_FOUND" } }, 404);
        }
        if (url.endsWith("/commerce/status")) {
          return json({
            storeEnvironment: "SANDBOX",
            activeOfferCount: 1,
            offersWithoutValidatedProduct: 0,
          });
        }
        if (url.endsWith("/commerce/entitlements")) {
          return json({
            items: [
              {
                key: "deck.european_coats",
                status: "ACTIVE",
                deckCodes: [],
              },
            ],
            total: 1,
          });
        }
        return json({
          items: [
            {
              id: "70000000-0000-4000-8000-000000000001",
              code: "EUROPEAN_COATS_LIFETIME",
              kind: "ONE_TIME",
              status: "ACTIVE",
              grants: ["deck.european_coats"],
              products: [
                {
                  id: "70000000-0000-4000-8000-000000000002",
                  provider: "APPLE_APP_STORE",
                  storeEnvironment: "SANDBOX",
                  bundleId: "app.countryflags",
                  productId: "european_coats",
                  productType: "NON_CONSUMABLE",
                  status: "VALIDATED",
                },
              ],
            },
          ],
          total: 1,
        });
      }
      if (url.includes("/content/decks")) {
        return json({
          items: options.publishedDecks ?? [],
          total: (options.publishedDecks ?? []).length,
        });
      }
      if (url.includes("/decks/")) {
        return json(deck);
      }
      if (url.endsWith("/entities")) {
        return json({ items: ENTITIES, total: ENTITIES.length });
      }
      if (url.endsWith("/decks")) {
        return json({ items: [], total: 0 });
      }
      return json({
        id: DRAFT_ID,
        baseContentVersion: "2026.09.01",
        baseCatalogCommit: "dev",
        schemaVersion: 3,
        revision: 7,
        status: "DRAFT",
        document: { schemaVersion: 3, entities: [], decks: [] },
        createdAt: "2026-09-05T09:00:00Z",
        updatedAt: "2026-09-05T09:00:00Z",
      });
    }),
  );
  return { sent: () => sent };
}

function renderEditor(deckKey: string): void {
  const client = createAdminApiClient("/api");
  render(
    <RuntimeConfigProvider config={config}>
      <ApiClientProvider client={client}>
        <MemoryRouter initialEntries={[`/drafts/${DRAFT_ID}/decks/${deckKey}`]}>
          <Routes>
            <Route
              path="/drafts/:draftId/decks/:deckKey"
              element={<DeckEditor />}
            />
            <Route path="/drafts/:draftId" element={<div>draft</div>} />
          </Routes>
        </MemoryRouter>
      </ApiClientProvider>
    </RuntimeConfigProvider>,
  );
}

/** MUI opens a select on mousedown, not on click. */
function pickOption(selectName: string | RegExp, option: string | RegExp) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: selectName }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

describe("card refs", () => {
  it("names a card the way the backend names it", () => {
    expect(
      cardIdentity({
        entityKey: "country.germany",
        templateCode: "COAT_OF_ARMS_TO_COUNTRY",
        templateSchemaVersion: 1,
      }),
    ).toBe("country.germany#COAT_OF_ARMS_TO_COUNTRY@1");
  });

  it("writes a member taught through the default as a bare key", () => {
    const defaults = {
      templateCode: "FLAG_TO_COUNTRY",
      templateSchemaVersion: 1,
    };
    expect(
      refsToMembers(
        [
          {
            entityKey: "country.germany",
            templateCode: "FLAG_TO_COUNTRY",
            templateSchemaVersion: 1,
          },
          {
            entityKey: "country.germany",
            templateCode: "COAT_OF_ARMS_TO_COUNTRY",
            templateSchemaVersion: 1,
          },
        ],
        defaults,
      ),
    ).toEqual([
      "country.germany",
      {
        entityKey: "country.germany",
        templateCode: "COAT_OF_ARMS_TO_COUNTRY",
        templateSchemaVersion: 1,
      },
    ]);
  });

  it("derives the published code from the editorial key", () => {
    expect(deckCodeFromKey("deck.european-coats")).toBe("EUROPEAN_COATS");
  });

  it("refuses an entitlement key that is not one", () => {
    expect(entitlementKeyProblem("European Coats")).toContain("Write it as");
    expect(entitlementKeyProblem("deck.european_coats")).toBeNull();
  });
});

describe("deck membership editor", () => {
  it("holds one country under two templates as two members", async () => {
    const stub = stubApi(deckDetail());
    renderEditor("deck.symbols-sampler");
    await screen.findByText("In this deck (1)");

    pickOption("Add as", "Coat of arms → name");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add country.germany#COAT_OF_ARMS_TO_COUNTRY@1",
      }),
    );

    await screen.findByText("In this deck (2)");
    fireEvent.click(screen.getByRole("button", { name: "Save deck" }));
    await waitFor(() => {
      expect(stub.sent()).not.toBeNull();
    });
    expect(stub.sent()?.members).toEqual([
      "country.germany",
      {
        entityKey: "country.germany",
        templateCode: "COAT_OF_ARMS_TO_COUNTRY",
        templateSchemaVersion: 1,
      },
    ]);
  });

  it("adds the U.S. states in one click", async () => {
    const stub = stubApi(deckDetail({ members: [], memberKeys: [] }));
    renderEditor("deck.symbols-sampler");
    await screen.findByText("In this deck (0)");

    fireEvent.click(
      await screen.findByRole("button", {
        name: /Add the U\.S\. states \(3\)/,
      }),
    );
    await screen.findByText("In this deck (3)");

    fireEvent.click(screen.getByRole("button", { name: "Save deck" }));
    await waitFor(() => {
      expect(stub.sent()).not.toBeNull();
    });
    expect(stub.sent()?.members).toEqual([
      "subdivision.us.california",
      "subdivision.us.texas",
      "subdivision.usa.ohio",
    ]);
  });

  it("reorders members and keeps the order as the deck's own", async () => {
    const stub = stubApi(
      deckDetail({
        members: ["country.germany", "country.france"],
        memberCount: 2,
      }),
    );
    renderEditor("deck.symbols-sampler");
    await screen.findByText("In this deck (2)");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Move country.france#FLAG_TO_COUNTRY@1 up",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save deck" }));
    await waitFor(() => {
      expect(stub.sent()).not.toBeNull();
    });
    expect(stub.sent()?.members).toEqual(["country.france", "country.germany"]);
  });

  it("drops a starred member from the deck and from the preview at once", async () => {
    const stub = stubApi(
      deckDetail({
        members: ["country.germany", "country.france"],
        memberCount: 2,
        previewCardIds: ["country.france#FLAG_TO_COUNTRY@1"],
      }),
    );
    renderEditor("deck.symbols-sampler");
    await screen.findByText("In this deck (2)");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove country.france#FLAG_TO_COUNTRY@1",
      }),
    );
    await screen.findByText("In this deck (1)");

    fireEvent.click(screen.getByRole("button", { name: "Save deck" }));
    await waitFor(() => {
      expect(stub.sent()).not.toBeNull();
    });
    // Both halves of the removal survive: two updates of one value would
    // have left the second overwriting the first.
    expect(stub.sent()?.members).toEqual(["country.germany"]);
    expect(stub.sent()?.previewCardIds).toEqual([]);
  });

  it("stars at most three previews, each of them a member", async () => {
    const stub = stubApi(
      deckDetail({
        members: ["country.germany", "country.france"],
        memberCount: 2,
      }),
    );
    renderEditor("deck.symbols-sampler");
    await screen.findByText("In this deck (2)");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Set country.france#FLAG_TO_COUNTRY@1 as a preview card",
      }),
    );
    await screen.findByText("Public preview (1 of 3)");

    fireEvent.click(screen.getByRole("button", { name: "Save deck" }));
    await waitFor(() => {
      expect(stub.sent()).not.toBeNull();
    });
    expect(stub.sent()?.previewCardIds).toEqual([
      "country.france#FLAG_TO_COUNTRY@1",
    ]);
  });
});

describe("the Access block", () => {
  it("never offers a price and marks the environment", async () => {
    stubApi(deckDetail(), { commerce: true });
    renderEditor("deck.symbols-sampler");
    await screen.findByText("Access");

    fireEvent.click(
      screen.getByRole("radio", { name: /Paid — an entitlement is required/ }),
    );
    expect(await screen.findByText(/store SANDBOX/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/price/i)).toBeNull();
    expect(screen.getAllByText("DEV").length).toBeGreaterThan(0);
  });

  it("checks the entitlement, its offer and the product in this environment", async () => {
    stubApi(
      deckDetail({
        access: access({
          model: "ENTITLEMENT",
          requiredEntitlementKey: "deck.european_coats",
        }),
      }),
      { commerce: true },
    );
    renderEditor("deck.symbols-sampler");

    expect(await screen.findByText(/the entitlement exists/)).toHaveTextContent(
      "✓",
    );
    expect(screen.getByText(/an active offer grants it/)).toHaveTextContent(
      "✓",
    );
    expect(
      screen.getByText(/its product is verified in this environment/),
    ).toHaveTextContent("✓");
    expect(screen.getByText(/EUROPEAN_COATS_LIFETIME/)).toBeInTheDocument();
  });

  it("says it cannot check when the commerce contour is not served here", async () => {
    stubApi(
      deckDetail({
        access: access({
          model: "ENTITLEMENT",
          requiredEntitlementKey: "deck.european_coats",
        }),
      }),
    );
    renderEditor("deck.symbols-sampler");

    expect(
      await screen.findByText(/does not serve the commerce contour yet/),
    ).toBeInTheDocument();
    expect(screen.getByText(/the entitlement exists/)).toHaveTextContent("…");
  });

  it("refuses to make a published free deck paid", async () => {
    stubApi(deckDetail(), {
      publishedDecks: [
        {
          id: "80000000-0000-4000-8000-000000000001",
          code: "SYMBOLS_SAMPLER",
          kind: "CURATED",
          status: "PUBLISHED",
          cardCount: 1,
          nameRu: "Символы",
          nameEn: "Symbols",
          contentVersion: "2026.09.01",
        },
      ],
    });
    renderEditor("deck.symbols-sampler");

    expect(
      await screen.findByText(/it cannot be made paid/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Paid — an entitlement is required/ }),
    ).toBeDisabled();
  });

  it("locks the entitlement key of a published paid deck", async () => {
    stubApi(
      deckDetail({
        access: access({
          model: "ENTITLEMENT",
          requiredEntitlementKey: "deck.european_coats",
        }),
      }),
      {
        publishedDecks: [
          {
            id: "80000000-0000-4000-8000-000000000001",
            code: "SYMBOLS_SAMPLER",
            kind: "CURATED",
            status: "PUBLISHED",
            cardCount: 1,
            nameRu: "Символы",
            nameEn: "Symbols",
            contentVersion: "2026.09.01",
          },
        ],
      },
    );
    renderEditor("deck.symbols-sampler");

    const field = await screen.findByRole("textbox", {
      name: /Entitlement key/,
    });
    await waitFor(() => {
      expect(field).toBeDisabled();
    });
    expect(
      screen.getByText(/Changing it is an entitlement migration/),
    ).toBeInTheDocument();
  });
});
