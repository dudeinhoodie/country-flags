import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-admin", () => ({
  Title: () => null,
  usePermissions: () => ({ permissions: "EDITOR" }),
  useGetIdentity: () => ({ identity: undefined }),
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
  features: {},
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

const TEMPLATES: Record<string, { assetType: string; kinds: string[] }> = {
  FLAG_TO_COUNTRY: {
    assetType: "FLAG",
    kinds: ["country", "territory", "area", "subdivision"],
  },
  COAT_OF_ARMS_TO_COUNTRY: {
    assetType: "COAT_OF_ARMS",
    kinds: ["country", "territory", "area"],
  },
};

/**
 * The card library as the server answers it (#356): entity/template pairs,
 * with the readiness and the disabled reason already worked out. The stub
 * applies the query the console sends, so a test that filters is testing the
 * request the console makes rather than a list it kept to itself.
 */
function candidatesFor(url: URL, held: ReadonlySet<string>): unknown {
  const search = (url.searchParams.get("search") ?? "").toLowerCase();
  const kind = url.searchParams.get("entityType");
  const parent = url.searchParams.get("parentKey");
  const templateCode =
    url.searchParams.get("templateCode") ?? "FLAG_TO_COUNTRY";
  const template = TEMPLATES[templateCode] ?? TEMPLATES.FLAG_TO_COUNTRY;
  const items = ENTITIES.filter((entity) => {
    if (!(template?.kinds ?? []).includes(entity.type)) {
      return false;
    }
    if (kind !== null && entity.type !== kind) {
      return false;
    }
    if (parent !== null && entity.parentKey !== parent) {
      return false;
    }
    if (search === "") {
      return true;
    }
    return (
      entity.key.toLowerCase().includes(search) ||
      (entity.publishedName ?? "").toLowerCase().includes(search)
    );
  }).map((entity) => {
    const cardId = `${entity.key}#${templateCode}@1`;
    const hasAsset =
      template?.assetType === "COAT_OF_ARMS"
        ? entity.hasCoatOfArms === true
        : true;
    const inDeck = held.has(cardId);
    return {
      cardId,
      entityKey: entity.key,
      entityType: entity.type,
      entityStatus: entity.status,
      parentKey: entity.parentKey,
      entityName: entity.publishedName,
      templateCode,
      templateSchemaVersion: 1,
      assetType: template?.assetType ?? null,
      hasAsset,
      locales: { required: [], present: [], missing: [], complete: true },
      delivery: null,
      inDeck,
      available: hasAsset && !inDeck,
      disabledReason: inDeck
        ? { code: "ALREADY_IN_DECK", message: "The deck already holds it" }
        : hasAsset
          ? null
          : { code: "ASSET_MISSING", message: "There is no coat of arms yet" },
    };
  });
  return { items, total: items.length, draftRevision: 1 };
}

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
  options: {
    publishedDecks?: unknown[];
    commerce?: boolean;
    conflictOnSave?: boolean;
  } = {},
): Stub {
  let sent: Record<string, unknown> | null = null;
  const held = new Set(
    (Array.isArray(deck.members) ? deck.members : []).map((member) =>
      typeof member === "string"
        ? `${member}#${deck.defaultTemplateCode ?? "FLAG_TO_COUNTRY"}@1`
        : `${member.entityKey}#${member.templateCode}@${String(member.templateSchemaVersion)}`,
    ),
  );
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
        if (options.conflictOnSave === true) {
          return json(
            {
              error: {
                code: "DRAFT_REVISION_CONFLICT",
                message: "The draft moved on",
                requestId: DRAFT_ID,
                details: {
                  draftId: DRAFT_ID,
                  expectedRevision: 1,
                  currentRevision: 4,
                  updatedAt: "2026-09-05T10:00:00Z",
                  updatedByAdminUserId: "00000000-0000-4000-8000-000000000009",
                },
              },
            },
            409,
          );
        }
        return json({
          draftId: DRAFT_ID,
          revision: 8,
          status: "DRAFT",
          updatedAt: "2026-09-05T10:00:00Z",
        });
      }
      if (url.includes("/card-candidates")) {
        return json(candidatesFor(new URL(url), held));
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

function renderEditor(deckKey: string, at = ""): void {
  const client = createAdminApiClient("/api");
  render(
    <RuntimeConfigProvider config={config}>
      <ApiClientProvider client={client}>
        <MemoryRouter
          initialEntries={[`/drafts/${DRAFT_ID}/decks/${deckKey}${at}`]}
        >
          <Routes>
            <Route
              path="/drafts/:draftId/decks/:deckKey"
              element={<DeckEditor />}
            />
            <Route
              path="/drafts/:draftId/decks/:deckKey/:tab"
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

/** The tabs are links, so opening one is a click on a link. */
function openTab(name: string): void {
  fireEvent.click(screen.getByRole("tab", { name }));
}

/** Opens the deck's Cards tab and waits for the list to be there. */
async function openCards(): Promise<void> {
  fireEvent.click(await screen.findByRole("tab", { name: "Cards" }));
  await screen.findByText(/^In this deck/);
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
    await openCards();

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

  // The library is searched on the server, so a bulk recipe is "everything
  // these filters match" rather than a list of countries the console keeps.
  it("adds every card the filters match in one click", async () => {
    const stub = stubApi(deckDetail({ members: [], memberKeys: [] }));
    renderEditor("deck.symbols-sampler");
    await openCards();

    pickOption("Kind", "subdivision");
    fireEvent.change(screen.getByRole("textbox", { name: /Parent/ }), {
      target: { value: "country.united_states" },
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Add all 3 matching" }),
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

  it("says why a card cannot be added rather than greying it out", async () => {
    stubApi(deckDetail({ members: [], memberKeys: [] }));
    renderEditor("deck.symbols-sampler");
    await openCards();

    pickOption("Add as", "Coat of arms → name");
    // France has no coat of arms in the fixture, and the server says so.
    expect(
      await screen.findByText(/There is no coat of arms yet/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Add country.france#COAT_OF_ARMS_TO_COUNTRY@1",
      }),
    ).toBeDisabled();
  });

  it("reorders members and keeps the order as the deck's own", async () => {
    const stub = stubApi(
      deckDetail({
        members: ["country.germany", "country.france"],
        memberCount: 2,
      }),
    );
    renderEditor("deck.symbols-sampler");
    await openCards();

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

  // Acceptance criterion: a deck can be put in order from the keyboard
  // alone, and the keyboard does not lose its place while doing it.
  it("reorders from the keyboard and keeps focus on the card it moved", async () => {
    const stub = stubApi(
      deckDetail({
        members: ["country.germany", "country.france"],
        memberCount: 2,
      }),
    );
    renderEditor("deck.symbols-sampler");
    await openCards();

    const down = screen.getByRole("button", {
      name: "Move country.germany#FLAG_TO_COUNTRY@1 down",
    });
    down.focus();
    fireEvent.keyDown(down, { key: "ArrowDown", altKey: true });

    await waitFor(() => {
      // Germany is last now, so its own down arrow is disabled and focus
      // lands on the arrow that can still move it.
      expect(
        screen.getByRole("button", {
          name: "Move country.germany#FLAG_TO_COUNTRY@1 up",
        }),
      ).toHaveFocus();
    });

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
    await openCards();

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
    await openCards();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Set country.france#FLAG_TO_COUNTRY@1 as a preview card",
      }),
    );
    openTab("Presentation");
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

describe("the deck editor's own state", () => {
  it("has nothing to save or discard until something changes", async () => {
    stubApi(deckDetail());
    renderEditor("deck.symbols-sampler");
    await screen.findByText("Everything on this screen is saved.");

    expect(screen.getByRole("button", { name: "Save deck" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Discard changes" }),
    ).toBeDisabled();
  });

  it("puts the form back the way it was loaded", async () => {
    stubApi(deckDetail());
    renderEditor("deck.symbols-sampler");
    const name = await screen.findByRole("textbox", { name: "Name (en)" });

    fireEvent.change(name, { target: { value: "Renamed" } });
    expect(screen.getByText("Unsaved changes.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(name).toHaveValue("Symbols");
  });

  // Acceptance criterion 8, on the deck side: the write is refused and the
  // editor is told what it would have written.
  it("refuses to overwrite a revision somebody else moved", async () => {
    stubApi(deckDetail(), { conflictOnSave: true });
    renderEditor("deck.symbols-sampler");
    const name = await screen.findByRole("textbox", { name: "Name (en)" });

    fireEvent.change(name, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save deck" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/This draft moved while you were editing/),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Your unsaved values")).toHaveValue(
      'Names and descriptions: {"ru":{"name":"Символы","description":"Оба символа"},"en":{"name":"Renamed","description":"Both symbols"}}',
    );
  });

  // Acceptance criterion 7, on the deck side: a finding addressed to the
  // access tab opens it with the caret in the field it names.
  it("opens the tab and the field a finding names", async () => {
    stubApi(
      deckDetail({
        access: access({
          model: "ENTITLEMENT",
          requiredEntitlementKey: "deck.european_coats",
        }),
      }),
    );
    renderEditor(
      "deck.symbols-sampler",
      "/access?field=%2Faccess%2FrequiredEntitlementKey",
    );

    const field = await screen.findByRole("textbox", {
      name: /Entitlement key/,
    });
    await waitFor(() => {
      expect(field).toHaveFocus();
    });
  });
});

describe("the Access block", () => {
  it("never offers a price and marks the environment", async () => {
    stubApi(deckDetail(), { commerce: true });
    renderEditor("deck.symbols-sampler", "/access");
    await screen.findByRole("radiogroup");

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
    renderEditor("deck.symbols-sampler", "/access");

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
    renderEditor("deck.symbols-sampler", "/access");

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
    renderEditor("deck.symbols-sampler", "/access");

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
    renderEditor("deck.symbols-sampler", "/access");

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
