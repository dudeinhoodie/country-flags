import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-admin", () => ({
  Title: () => null,
  usePermissions: () => ({ permissions: "EDITOR" }),
}));

import { createAdminApiClient } from "../src/api/client";
import { ApiClientProvider } from "../src/api/ApiClientContext";
import {
  DraftEntities,
  keeps,
  NO_PARENT,
} from "../src/resources/drafts/DraftEntities";
import {
  EntityEditor,
  identifierError,
} from "../src/resources/drafts/EntityEditor";
import type { DraftEntityListItem } from "../src/resources/drafts/useDraftEntities";

const DRAFT_ID = "3d1b1c1e-0000-4000-8000-000000000001";

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
    ...fixture,
  };
}

const UNITED_STATES = listItem({
  key: "country.united_states",
  type: "country",
});
const FRANCE = listItem({ key: "country.france", type: "country" });
const EUROPE = listItem({
  key: "region.europe",
  type: "region",
  hasFlag: false,
});
const CALIFORNIA = listItem({
  key: "subdivision.us.california",
  type: "subdivision",
  parentKey: "country.united_states",
  includeInCountryCatalog: false,
});
const LIST = [UNITED_STATES, FRANCE, EUROPE, CALIFORNIA];

interface Detail {
  entity: Record<string, unknown>;
  publishedNames: Record<string, string>;
}

/**
 * The console talks to the real generated client; only the network is a
 * stub, so what the editor sends is what the backend would receive.
 */
function stubApi(detail: Detail): { patched: () => unknown } {
  let patched: unknown = null;
  vi.stubGlobal(
    "fetch",
    // openapi-fetch always hands the real fetch a Request, so the stub takes
    // one: the body is a stream to be read rather than a value to stringify.
    vi.fn(async (request: Request) => {
      const url = request.url;
      const method = request.method.toUpperCase();
      const json = (body: unknown): Response =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      if (method === "PATCH") {
        patched = JSON.parse(await request.text()) as unknown;
        return json({
          draftId: DRAFT_ID,
          revision: 8,
          status: "DRAFT",
          updatedAt: "2026-09-04T10:00:00Z",
        });
      }
      if (url.endsWith("/decks")) {
        return json({ items: [], total: 0 });
      }
      if (url.includes("/entities/")) {
        return json(detail);
      }
      if (url.endsWith("/entities")) {
        return json({ items: LIST, total: LIST.length });
      }
      return json({
        id: DRAFT_ID,
        baseContentVersion: "2026.09.01",
        baseCatalogCommit: "dev",
        schemaVersion: 2,
        revision: 7,
        status: "DRAFT",
        document: { schemaVersion: 2, entities: [], decks: [] },
        createdAt: "2026-09-04T09:00:00Z",
        updatedAt: "2026-09-04T09:00:00Z",
      });
    }),
  );
  return { patched: () => patched };
}

function renderEditor(entityKey: string): void {
  const client = createAdminApiClient("/api");
  render(
    <ApiClientProvider client={client}>
      <MemoryRouter
        initialEntries={[`/drafts/${DRAFT_ID}/entities/${entityKey}`]}
      >
        <Routes>
          <Route
            path="/drafts/:draftId/entities/:entityKey"
            element={<EntityEditor />}
          />
          <Route path="/drafts/:draftId/entities" element={<div>list</div>} />
        </Routes>
      </MemoryRouter>
    </ApiClientProvider>,
  );
}

function renderList(): void {
  const client = createAdminApiClient("/api");
  render(
    <ApiClientProvider client={client}>
      <MemoryRouter initialEntries={[`/drafts/${DRAFT_ID}/entities`]}>
        <Routes>
          <Route path="/drafts/:draftId/entities" element={<DraftEntities />} />
        </Routes>
      </MemoryRouter>
    </ApiClientProvider>,
  );
}

const countryDetail: Detail = {
  entity: {
    key: "country.france",
    type: "country",
    status: "active",
    includeInCountryCatalog: true,
    recognitionStatus: "un_member",
    parentKey: null,
    identifiers: { isoAlpha2: "FR" },
  },
  publishedNames: { en: "France" },
};

const publishedSubdivision: Detail = {
  entity: {
    key: "subdivision.us.california",
    type: "subdivision",
    status: "active",
    includeInCountryCatalog: false,
    recognitionStatus: "not_applicable",
    parentKey: "country.united_states",
    identifiers: { isoSubdivision: "US-CA" },
    facts: { capital: { en: "Sacramento" }, statehoodDate: "1850-09-09" },
  },
  publishedNames: { en: "California" },
};

/** MUI opens a select on mousedown, not on click. */
function pickOption(selectName: string | RegExp, option: string): void {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: selectName }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

async function pickParent(key: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(key) }));
}

function typeInto(name: string | RegExp, value: string): void {
  fireEvent.change(screen.getByRole("textbox", { name }), {
    target: { value },
  });
}

describe("identifierError", () => {
  it("keeps a subdivision code out of the ISO country fields", () => {
    // The whole reason `isoSubdivision` is a field of its own: US-CA in
    // isoAlpha2 would put a state everywhere a reader expects a country.
    expect(identifierError("isoAlpha2", "US-CA")).toBe(
      "Expected two letters, as in FR",
    );
    expect(identifierError("isoAlpha3", "US-CA")).toBe(
      "Expected three letters, as in FRA",
    );
    expect(identifierError("isoSubdivision", "US-CA")).toBeNull();
    expect(identifierError("isoAlpha2", "FR")).toBeNull();
    expect(identifierError("isoSubdivision", "FR")).toBe(
      "Expected ISO 3166-2, as in US-CA",
    );
    // An empty field is not an error; it is simply not set.
    expect(identifierError("isoAlpha2", "")).toBeNull();
  });
});

describe("the entity list filters", () => {
  const none = {
    query: "",
    type: "",
    parentKey: "",
    status: "",
    missingFlag: false,
    missingCoat: false,
  };
  const california = CALIFORNIA;

  it("answers 'missing a coat' from the list itself", () => {
    expect(keeps(california, { ...none, missingCoat: true })).toBe(true);
    expect(keeps(california, { ...none, missingFlag: true })).toBe(false);
  });

  it("narrows by kind, parent and status", () => {
    expect(keeps(california, { ...none, type: "subdivision" })).toBe(true);
    expect(keeps(california, { ...none, type: "country" })).toBe(false);
    expect(
      keeps(california, { ...none, parentKey: "country.united_states" }),
    ).toBe(true);
    expect(keeps(california, { ...none, parentKey: "country.france" })).toBe(
      false,
    );
    expect(keeps(FRANCE, { ...none, parentKey: NO_PARENT })).toBe(true);
    expect(keeps(california, { ...none, parentKey: NO_PARENT })).toBe(false);
    expect(keeps(california, { ...none, status: "retired" })).toBe(false);
  });
});

describe("EntityEditor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers subdivision and asks it for the country it belongs to", async () => {
    stubApi(countryDetail);
    renderEditor("country.france");
    await screen.findByDisplayValue("country.france");

    pickOption("Type", "subdivision");

    expect(
      await screen.findByRole("combobox", { name: /Parent/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "A subdivision needs the country or territory it belongs to.",
      ),
    ).toBeInTheDocument();
    // Nothing may be saved while the state has nowhere to belong.
    expect(screen.getByRole("button", { name: "Save entity" })).toBeDisabled();
  });

  it("shows the country catalog off and says why, rather than hiding it", async () => {
    stubApi(countryDetail);
    renderEditor("country.france");
    await screen.findByDisplayValue("country.france");
    const toggle = screen.getByLabelText("In country catalog");
    expect(toggle).toBeChecked();

    pickOption("Type", "subdivision");

    expect(toggle).not.toBeChecked();
    expect(toggle).toBeDisabled();
    expect(
      screen.getByText(
        "A subdivision is taught only through a deck that names it, so it never joins the country catalog.",
      ),
    ).toBeInTheDocument();
  });

  it("blocks a save while an identifier is the wrong shape", async () => {
    stubApi(countryDetail);
    renderEditor("country.france");
    await screen.findByDisplayValue("country.france");

    typeInto("isoAlpha2", "US-CA");
    expect(
      screen.getByText("Expected two letters, as in FR"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save entity" })).toBeDisabled();

    typeInto("isoAlpha2", "FR");
    expect(screen.getByRole("button", { name: "Save entity" })).toBeEnabled();
  });

  it("sends the parent and the facts the form holds", async () => {
    const api = stubApi(countryDetail);
    renderEditor("country.france");
    await screen.findByDisplayValue("country.france");

    pickOption("Type", "subdivision");
    await pickParent("country.united_states");
    typeInto("Capital (en)", "Sacramento");
    typeInto("Statehood date", "1850-09-09");
    typeInto("Population", "39400000");
    typeInto("Languages (en)", "English, Spanish");
    fireEvent.click(screen.getByRole("button", { name: "Save entity" }));

    await waitFor(() => {
      expect(api.patched()).not.toBeNull();
    });
    expect(api.patched()).toMatchObject({
      type: "subdivision",
      parentKey: "country.united_states",
      includeInCountryCatalog: false,
      recognitionStatus: "not_applicable",
      facts: {
        capital: { en: "Sacramento" },
        statehoodDate: "1850-09-09",
        population: { value: 39400000 },
        languages: [{ en: "English" }, { en: "Spanish" }],
      },
    });
  });

  it("asks before moving a published subdivision to another country", async () => {
    const api = stubApi(publishedSubdivision);
    renderEditor("subdivision.us.california");
    await screen.findByDisplayValue("subdivision.us.california");
    // What the entity already carries is shown as facts, not as raw paths.
    expect(screen.getByRole("textbox", { name: "Capital (en)" })).toHaveValue(
      "Sacramento",
    );

    await pickParent("country.france");
    fireEvent.click(screen.getByRole("button", { name: "Save entity" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Move a published subdivision?"),
    ).toBeInTheDocument();
    // Nothing reached the backend while the question was open.
    expect(api.patched()).toBeNull();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Keep the parent" }),
    );
    expect(api.patched()).toBeNull();

    // The dialog holds focus until it is gone, so the form comes back only
    // once the question has been answered.
    fireEvent.click(await screen.findByRole("button", { name: "Save entity" }));
    const reopened = await screen.findByRole("dialog");
    fireEvent.click(
      within(reopened).getByRole("button", {
        name: "Move it to country.france",
      }),
    );
    await waitFor(() => {
      expect(api.patched()).toMatchObject({ parentKey: "country.france" });
    });
  });
});

describe("DraftEntities", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("filters the rendered list by kind and by a missing symbol", async () => {
    stubApi(countryDetail);
    renderList();
    await screen.findByText("subdivision.us.california", { selector: "code" });

    pickOption("Kind", "subdivision");
    expect(
      screen.queryByText("country.france", { selector: "code" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("subdivision.us.california", { selector: "code" }),
    ).toBeInTheDocument();

    // The state has a flag and no coat: it stays under "missing coat" and
    // leaves under "missing flag".
    fireEvent.click(screen.getByLabelText("Missing coat"));
    expect(
      screen.getByText("subdivision.us.california", { selector: "code" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Missing flag"));
    expect(
      screen.queryByText("subdivision.us.california", { selector: "code" }),
    ).not.toBeInTheDocument();
  });
});
