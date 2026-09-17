import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientProvider } from "../src/api/ApiClientContext";
import { createAdminApiClient } from "../src/api/client";
import { RuntimeConfigProvider } from "../src/config/RuntimeConfigContext";
import { SiteDocumentEditor } from "../src/resources/site/SiteDocumentEditor";
import { SiteDocumentsPage } from "../src/resources/site/SiteDocumentsPage";
import type { RuntimeConfig } from "../src/config/runtime-config";

const session = vi.hoisted(() => ({ permissions: "PUBLISHER" }));

vi.mock("react-admin", () => ({
  Title: () => null,
  usePermissions: () => ({ permissions: session.permissions }),
}));

const config: RuntimeConfig = {
  environment: "dev",
  apiBasePath: "/api",
  googleClientId: "",
  appVersion: "abc1234",
  features: {},
};

const ADMIN_ID = "8f1f9f76-1f0a-4a2e-9a5e-2b8f4f1c9d10";

const status = {
  snapshotConfigured: true,
  snapshotBaseUrl: "https://storage.googleapis.com/country-flags-site-dev",
  siteUrl: "https://site-dev.example",
  publishedCount: 1,
};

const privacyEn = {
  slug: "privacy",
  locale: "en",
  title: "Privacy Policy",
  revision: 3,
  publishedVersion: 2,
  publishedAt: "2026-09-14T10:00:00Z",
  hasUnpublishedChanges: false,
  updatedAt: "2026-09-14T10:00:00Z",
  updatedByAdminUserId: ADMIN_ID,
  createdAt: "2026-09-01T10:00:00Z",
  createdByAdminUserId: ADMIN_ID,
  body: "## Accounts\n\nAn account is optional.\n",
  html: "<h2>Accounts</h2>\n<p>An account is optional.</p>\n",
};

const termsRu = {
  ...privacyEn,
  slug: "terms",
  locale: "ru",
  title: "Условия использования",
  publishedVersion: null,
  publishedAt: null,
  hasUnpublishedChanges: true,
};

const versions = {
  items: [
    {
      version: 2,
      title: "Privacy Policy",
      note: null,
      publishedAt: "2026-09-14T10:00:00Z",
      publishedByAdminUserId: ADMIN_ID,
      current: true,
    },
    {
      version: 1,
      title: "Privacy",
      note: "First publication",
      publishedAt: "2026-09-01T10:00:00Z",
      publishedByAdminUserId: ADMIN_ID,
      current: false,
    },
  ],
};

type FetchInput = Request | string;

interface Recorded {
  method: string;
  url: string;
  body: unknown;
}

function stubApi(
  overrides: Partial<Record<string, (request: Recorded) => Response>> = {},
): { fetchMock: ReturnType<typeof vi.fn>; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchMock = vi.fn(async (input: FetchInput) => {
    const url = typeof input === "string" ? input : input.url;
    const method = typeof input === "string" ? "GET" : input.method;
    const text = typeof input === "string" ? "" : await input.text();
    const body: unknown = text === "" ? null : JSON.parse(text);
    const recorded = { method, url, body };
    calls.push(recorded);
    const path = new URL(url).pathname.replace(/^\/api/, "");
    const override = overrides[`${method} ${path}`];
    if (override !== undefined) {
      return override(recorded);
    }
    if (path === "/v1/admin/site/status") {
      return Response.json(status);
    }
    if (path === "/v1/admin/site/documents" && method === "GET") {
      return Response.json({ items: [privacyEn, termsRu] });
    }
    if (path === "/v1/admin/site/documents" && method === "POST") {
      return Response.json(
        { ...termsRu, slug: "support", locale: "en", title: "Support" },
        { status: 201 },
      );
    }
    if (path === "/v1/admin/site/documents/preview") {
      const markdown = (body as { body: string }).body;
      return Response.json({ html: `<p>PREVIEW:${markdown}</p>` });
    }
    if (path === "/v1/admin/site/documents/privacy/en" && method === "GET") {
      return Response.json(privacyEn);
    }
    if (path === "/v1/admin/site/documents/privacy/en" && method === "PATCH") {
      const changes = body as { revision: number; body?: string };
      return Response.json({
        ...privacyEn,
        revision: changes.revision + 1,
        body: changes.body ?? privacyEn.body,
        hasUnpublishedChanges: true,
      });
    }
    if (path === "/v1/admin/site/documents/privacy/en/publish") {
      return Response.json({
        ...privacyEn,
        publishedVersion: 3,
        hasUnpublishedChanges: false,
      });
    }
    if (path === "/v1/admin/site/documents/privacy/en/versions") {
      return Response.json(versions);
    }
    return Response.json(
      { error: { code: "RESOURCE_NOT_FOUND", message: `no stub for ${path}` } },
      { status: 404 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function renderAt(path: string) {
  const client = createAdminApiClient("/api");
  return render(
    <RuntimeConfigProvider config={config}>
      <ApiClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/site/documents" element={<SiteDocumentsPage />} />
            <Route
              path="/site/documents/:slug/:locale"
              element={<SiteDocumentEditor />}
            />
          </Routes>
        </MemoryRouter>
      </ApiClientProvider>
    </RuntimeConfigProvider>,
  );
}

describe("site documents", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    session.permissions = "PUBLISHER";
  });

  it("lists every document with what the site serves and a link to it", async () => {
    stubApi();
    renderAt("/site/documents");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Site documents" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Privacy Policy")).toBeInTheDocument();
    expect(screen.getByText("Published · v2")).toBeInTheDocument();
    expect(screen.getByText("Условия использования")).toBeInTheDocument();
    expect(screen.getByText("Not published")).toBeInTheDocument();
    const live = screen.getByRole("link", { name: "On the site" });
    expect(live).toHaveAttribute(
      "href",
      "https://site-dev.example/privacy?lang=en",
    );
  });

  it("starts a document from the form and opens its editor", async () => {
    const { calls } = stubApi({
      "GET /v1/admin/site/documents/support/en": () =>
        Response.json({
          ...privacyEn,
          slug: "support",
          locale: "en",
          title: "Support",
          publishedVersion: null,
          publishedAt: null,
          hasUnpublishedChanges: true,
          body: "",
          html: "",
        }),
      "GET /v1/admin/site/documents/support/en/versions": () =>
        Response.json({ items: [] }),
    });
    renderAt("/site/documents");
    await screen.findByText("Privacy Policy");
    fireEvent.change(screen.getByLabelText("Address"), {
      target: { value: "Support" },
    });
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Support" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start draft" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Support" }),
    ).toBeInTheDocument();
    const create = calls.find(
      (call) =>
        call.method === "POST" && call.url.endsWith("/v1/admin/site/documents"),
    );
    expect(create?.body).toEqual({
      slug: "support",
      locale: "en",
      title: "Support",
    });
  });

  it("keeps a viewer out of the form", async () => {
    session.permissions = "VIEWER";
    stubApi();
    renderAt("/site/documents");
    await screen.findByText("Privacy Policy");
    expect(screen.getByRole("button", { name: "Start draft" })).toBeDisabled();
    expect(
      screen.getByText(/Drafting one needs the EDITOR role/),
    ).toBeInTheDocument();
  });

  it("saves the draft with its revision, previews through the server and publishes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { calls } = stubApi();
      renderAt("/site/documents/privacy/en");
      expect(
        await screen.findByRole("heading", {
          level: 1,
          name: "Privacy Policy",
        }),
      ).toBeInTheDocument();
      // Nothing to publish while the site already serves this text.
      expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
      expect(
        screen.getByText("The site already serves this text"),
      ).toBeInTheDocument();
      expect(screen.getByText("On the site")).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("Markdown"), {
        target: { value: "## Accounts\n\nChanged.\n" },
      });
      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(500);
      await waitFor(() => {
        expect(
          screen.getByRole("region", { name: "Preview" }),
        ).toHaveTextContent("PREVIEW:## Accounts");
      });

      fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
      await waitFor(() => {
        expect(screen.getByText("Ready to publish")).toBeInTheDocument();
      });
      const save = calls.find((call) => call.method === "PATCH");
      expect(save?.body).toEqual({
        revision: 3,
        body: "## Accounts\n\nChanged.\n",
      });

      fireEvent.click(screen.getByRole("button", { name: "Publish" }));
      fireEvent.change(screen.getByLabelText("Note for the history"), {
        target: { value: "Reworded accounts" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Publish", hidden: false }),
      );
      await waitFor(() => {
        expect(screen.getByText("Published · v3")).toBeInTheDocument();
      });
      const publish = calls.find((call) => call.url.endsWith("/publish"));
      expect(publish?.body).toEqual({ revision: 4, note: "Reworded accounts" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to overwrite a colleague and offers the latest instead", async () => {
    stubApi({
      "PATCH /v1/admin/site/documents/privacy/en": () =>
        Response.json(
          {
            error: {
              code: "SITE_DOCUMENT_REVISION_CONFLICT",
              message: "The document changed since it was read",
              details: { currentRevision: 5 },
            },
          },
          { status: 409 },
        ),
    });
    renderAt("/site/documents/privacy/en");
    await screen.findByRole("heading", { level: 1, name: "Privacy Policy" });
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Privacy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(
      await screen.findByText(
        /Someone changed this document since you opened it/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/now at revision 5/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Load the latest" }),
    ).toBeInTheDocument();
  });

  it("lists the versions and restores one into the draft", async () => {
    const { calls } = stubApi({
      "POST /v1/admin/site/documents/privacy/en/versions/1/restore": () =>
        Response.json({
          ...privacyEn,
          revision: 4,
          title: "Privacy",
          hasUnpublishedChanges: true,
        }),
    });
    renderAt("/site/documents/privacy/en");
    await screen.findByRole("heading", { level: 1, name: "Privacy Policy" });
    const table = await screen.findByRole("table", { name: "Versions" });
    expect(table).toHaveTextContent("v2");
    expect(table).toHaveTextContent("On the site");
    expect(table).toHaveTextContent("First publication");

    const restoreButtons = screen.getAllByRole("button", {
      name: "Restore into draft",
    });
    // The second row is version 1, the one that is not on the site.
    const olderVersion = restoreButtons.at(1);
    if (olderVersion === undefined) {
      throw new Error("expected a restore button per version");
    }
    fireEvent.click(olderVersion);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toHaveValue("Privacy");
    });
    const restore = calls.find((call) => call.url.endsWith("/restore"));
    expect(restore?.body).toEqual({ revision: 3 });
  });

  it("says when publishing reaches no site", async () => {
    stubApi({
      "GET /v1/admin/site/status": () =>
        Response.json({
          snapshotConfigured: false,
          snapshotBaseUrl: null,
          siteUrl: null,
          publishedCount: 0,
        }),
    });
    renderAt("/site/documents");
    expect(
      await screen.findByText(/no snapshot store configured/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "On the site" })).toBeNull();
  });
});
