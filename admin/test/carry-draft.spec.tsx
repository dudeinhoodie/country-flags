import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientProvider } from "../src/api/ApiClientContext";
import { createAdminApiClient } from "../src/api/client";
import { RuntimeConfigProvider } from "../src/config/RuntimeConfigContext";
import { CarryDraftPanel } from "../src/resources/drafts/CarryDraftPanel";
import type { RuntimeConfig } from "../src/config/runtime-config";

const DRAFT_ID = "3f2f1f76-1f0a-4a2e-9a5e-2b8f4f1c9d20";
const OLD_COMMIT = "aaaaaaaaaaaaaaaaaaaa";
const NEW_COMMIT = "bbbbbbbbbbbbbbbbbbbb";

const config: RuntimeConfig = {
  environment: "dev",
  apiBasePath: "/api",
  googleClientId: "",
  appVersion: "abc1234",
  features: {},
};

function stubCarry(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPanel(
  onCarried: () => void = () => undefined,
  baseCatalogCommit = OLD_COMMIT,
): void {
  render(
    <RuntimeConfigProvider config={config}>
      <ApiClientProvider client={createAdminApiClient(config.apiBasePath)}>
        <MemoryRouter initialEntries={[`/drafts/${DRAFT_ID}/release`]}>
          <CarryDraftPanel
            draftId={DRAFT_ID}
            draftRevision={7}
            baseCatalogCommit={baseCatalogCommit}
            catalogCommit={NEW_COMMIT}
            editable
            onCarried={onCarried}
          />
        </MemoryRouter>
      </ApiClientProvider>
    </RuntimeConfigProvider>,
  );
}

describe("carrying a draft onto the current catalog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says nothing at all while the draft is on the current catalog", () => {
    stubCarry(Response.json({}));
    renderPanel(() => undefined, NEW_COMMIT);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the carry when the catalog has moved, and states the two bases", async () => {
    const fetchMock = stubCarry(
      Response.json({
        draftId: DRAFT_ID,
        revision: 8,
        status: "DRAFT",
        previousBaseCatalogCommit: OLD_COMMIT,
        baseCatalogCommit: NEW_COMMIT,
        carried: true,
        incoming: [
          {
            objectType: "entity",
            objectKey: "country.france",
            change: "changed",
          },
        ],
      }),
    );
    const onCarried = vi.fn();
    renderPanel(onCarried);

    expect(
      screen.getByText("The catalog moved since this draft was imported"),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Carry onto the current catalog" }),
    );

    await vi.waitFor(() => {
      expect(onCarried).toHaveBeenCalled();
    });
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toContain(
      `/api/v1/admin/content/drafts/${DRAFT_ID}/carry`,
    );
    expect(await request.json()).toEqual({
      draftRevision: 7,
      baseCatalogCommit: OLD_COMMIT,
    });
  });

  /// The refusal is the interesting half: it has to name the field and
  /// offer the way to it, or the editor is back to reading a sentence and
  /// hunting for what it meant.
  it("lists a collision as a link into the field it happened on", async () => {
    stubCarry(
      Response.json(
        {
          error: {
            code: "CATALOG_CARRY_COLLISION",
            message: "The catalog and this draft changed the same thing",
            details: {
              draftBase: OLD_COMMIT,
              current: NEW_COMMIT,
              collisions: [
                {
                  level: "blocking",
                  code: "FIELD_CHANGED_ON_BOTH_SIDES",
                  subject: "country.germany",
                  message: "/recognitionStatus was changed on both sides",
                  target: {
                    objectType: "entity",
                    objectKey: "country.germany",
                    tab: "overview",
                    field: "/recognitionStatus",
                  },
                  route: `/drafts/${DRAFT_ID}/entities/country.germany`,
                },
              ],
            },
          },
        },
        { status: 409 },
      ),
    );
    const onCarried = vi.fn();
    renderPanel(onCarried);

    fireEvent.click(
      screen.getByRole("button", { name: "Carry onto the current catalog" }),
    );

    const link = await screen.findByRole("link", {
      name: /country\.germany/,
    });
    expect(link.getAttribute("href")).toBe(
      `/drafts/${DRAFT_ID}/entities/country.germany/overview?field=%2FrecognitionStatus`,
    );
    // Nothing was carried, so nothing is reloaded and the draft is untouched.
    expect(onCarried).not.toHaveBeenCalled();
  });

  it("opens the usual recovery dialog when the draft moved underneath", async () => {
    stubCarry(
      Response.json(
        {
          error: {
            code: "DRAFT_REVISION_CONFLICT",
            message: "The draft changed since it was read",
            details: {
              draftId: DRAFT_ID,
              expectedRevision: 7,
              currentRevision: 9,
              updatedAt: "2026-09-08T10:00:00Z",
              updatedByAdminUserId: "someone-else",
            },
          },
        },
        { status: 409 },
      ),
    );
    renderPanel();

    fireEvent.click(
      screen.getByRole("button", { name: "Carry onto the current catalog" }),
    );

    expect(
      await screen.findByText("This draft moved while you were editing"),
    ).toBeVisible();
  });
});
