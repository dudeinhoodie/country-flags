import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientProvider } from "../src/api/ApiClientContext";
import { createAdminApiClient } from "../src/api/client";
import { RuntimeConfigProvider } from "../src/config/RuntimeConfigContext";
import { DraftAssets } from "../src/resources/drafts/DraftAssets";
import type { RuntimeConfig } from "../src/config/runtime-config";

const config: RuntimeConfig = {
  environment: "dev",
  apiBasePath: "/api",
  googleClientId: "",
  appVersion: "abc1234",
};

const DRAFT_ID = "0f8f1f76-1f0a-4a2e-9a5e-2b8f4f1c9d10";
const FLAG_ID = "1a8f1f76-1f0a-4a2e-9a5e-2b8f4f1c9d11";
const COAT_ID = "2b8f1f76-1f0a-4a2e-9a5e-2b8f4f1c9d12";

const draft = {
  id: DRAFT_ID,
  status: "DRAFT",
  revision: 7,
  schemaVersion: 1,
  baseContentVersion: "2026.08.20",
  baseCatalogCommit: "abc1234",
  proposalUrl: null,
  validationReport: null,
  createdAt: "2026-09-05T10:00:00Z",
  updatedAt: "2026-09-05T10:00:00Z",
};

type FetchInput = Request | string;

function nth<Item>(items: Item[], index: number): Item {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Nothing at index ${String(index)}`);
  }
  return item;
}

function element(node: Element | null): HTMLElement {
  if (node === null) {
    throw new Error("The expected element is not on the page");
  }
  return node as HTMLElement;
}

function symbol(
  id: string,
  assetType: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    draftId: DRAFT_ID,
    entityContentKey: "country.germany",
    assetType,
    variant: "default",
    mimeType: "image/svg+xml",
    sha256: "a".repeat(64),
    width: null,
    height: null,
    aspectRatio: 0.8,
    sourceUrl: "https://commons.example.test/symbol.svg",
    licenseName: "CC0-1.0",
    licenseUrl: null,
    attribution: null,
    replacementReason: "The upstream drawing was wrong.",
    validationStatus: "VALID",
    validFrom: null,
    validTo: null,
    localizations: {},
    createdAt: "2026-09-05T10:00:00Z",
    updatedAt: "2026-09-05T10:00:00Z",
    ...overrides,
  };
}

function stubApi(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: FetchInput) => {
    const url = typeof input === "string" ? input : input.url;
    const method = typeof input === "string" ? "GET" : input.method;
    if (url.endsWith("/assets")) {
      return Promise.resolve(
        Response.json({
          items: [
            symbol(FLAG_ID, "FLAG"),
            symbol(COAT_ID, "COAT_OF_ARMS", {
              localizations: { en: { description: "Adopted 1950." } },
            }),
          ],
          total: 2,
        }),
      );
    }
    if (method === "PATCH") {
      return Promise.resolve(
        Response.json({
          draftId: DRAFT_ID,
          revision: draft.revision + 1,
          status: "DRAFT",
          updatedAt: "2026-09-05T10:05:00Z",
        }),
      );
    }
    return Promise.resolve(Response.json(draft));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestsTo(fetchMock: ReturnType<typeof vi.fn>): Request[] {
  return fetchMock.mock.calls
    .map((call) => (call as [FetchInput])[0])
    .filter((input): input is Request => input instanceof Request);
}

async function patchSentBy(
  fetchMock: ReturnType<typeof vi.fn>,
): Promise<Request> {
  return vi.waitFor(() => {
    const patch = requestsTo(fetchMock).find(
      (request) => request.method === "PATCH",
    );
    if (patch === undefined) {
      throw new Error("No PATCH was sent");
    }
    return patch;
  });
}

function renderEditor(): void {
  render(
    <RuntimeConfigProvider config={config}>
      <ApiClientProvider client={createAdminApiClient(config.apiBasePath)}>
        <DraftAssets draftId={DRAFT_ID} editable />
      </ApiClientProvider>
    </RuntimeConfigProvider>,
  );
}

describe("DraftAssets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives every symbol type a section of its own", async () => {
    stubApi();
    renderEditor();

    for (const label of ["Flag", "Coat of arms", "Map", "Other"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
    // One entity, two drawings, neither overwriting the other: the flag and
    // the coat each appear in a section of their own.
    expect(await screen.findAllByText("country.germany")).toHaveLength(2);
    // Each drawing is previewed on both grounds, because a symbol drawn for
    // one disappears on the other.
    expect(
      await screen.findAllByAltText("country.germany Flag, on dark"),
    ).toHaveLength(1);
    expect(
      await screen.findAllByAltText("country.germany Coat of arms, on light"),
    ).toHaveLength(1);
  });

  it("sends only what changed, stamped with the revision it was read at", async () => {
    const fetchMock = stubApi();
    renderEditor();

    // The coat of arms is the second section's row.
    fireEvent.click(
      nth(await screen.findAllByRole("button", { name: "Edit" }), 1),
    );
    fireEvent.change(nth(await screen.findAllByLabelText("Display name"), 0), {
      target: { value: "Federal eagle" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const patch = await patchSentBy(fetchMock);
    expect(patch.url).toContain(`/assets/${COAT_ID}`);
    // The drawing lives in its own table, but changing it moves the draft,
    // so the revision the editor read travels with the change.
    expect(patch.headers.get("If-Match")).toBe(String(draft.revision));
    expect(await patch.json()).toEqual({
      localizations: {
        en: { displayName: "Federal eagle", description: "Adopted 1950." },
      },
    });
  });

  it("retires a symbol by closing its validity rather than deleting it", async () => {
    const fetchMock = stubApi();
    renderEditor();

    fireEvent.click(
      nth(await screen.findAllByRole("button", { name: "Retire" }), 0),
    );

    const patch = await patchSentBy(fetchMock);
    const body = (await patch.json()) as { validTo: string };
    expect(body.validTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // No DELETE: the row and its audit trail stay.
    expect(
      requestsTo(fetchMock).some((request) => request.method === "DELETE"),
    ).toBe(false);
  });

  it("will not upload a symbol before an entity is named", async () => {
    stubApi();
    renderEditor();

    const section = element(
      (await screen.findByText("Coat of arms")).closest(".MuiPaper-root"),
    );
    fireEvent.click(
      within(section).getByRole("button", { name: "Upload or replace" }),
    );
    expect(
      within(section).getByRole("button", { name: "Upload" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Name the entity above first: a symbol belongs to one."),
    ).toBeInTheDocument();
  });
});
