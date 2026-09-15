import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SiteRoutes } from "../src/App";
import { RuntimeConfigProvider } from "../src/config/RuntimeConfigContext";
import type { RuntimeConfig } from "../src/config/runtime-config";

const INDEX = {
  generatedAt: "2026-09-15T10:00:00Z",
  documents: [
    {
      slug: "privacy",
      locale: "en",
      title: "Privacy Policy",
      version: 1,
      publishedAt: "2026-09-15T10:00:00Z",
    },
    {
      slug: "privacy",
      locale: "ru",
      title: "Политика конфиденциальности",
      version: 1,
      publishedAt: "2026-09-15T10:00:00Z",
    },
    {
      slug: "terms",
      locale: "en",
      title: "Terms of Use",
      version: 1,
      publishedAt: "2026-09-15T10:00:00Z",
    },
  ],
};

const DOCUMENTS: Record<string, Record<string, unknown>> = {
  "privacy.en.json": {
    ...INDEX.documents[0],
    html: "<p>Written from what the code does.</p><h2>Accounts</h2>",
  },
  "privacy.ru.json": {
    ...INDEX.documents[1],
    html: "<p>Написано по тому, что делает код.</p><h2>Учётные записи</h2>",
  },
  "terms.en.json": {
    ...INDEX.documents[2],
    html: "<p>These terms cover the app.</p>",
  },
};

type FetchInput = Request | string | URL;

function stubApi(
  overrides: Partial<Record<string, () => Promise<Response>>> = {},
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: FetchInput) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const name = url.replace(/^.*\/documents\//, "");
    const override = overrides[name];
    if (override !== undefined) {
      return override();
    }
    if (name === "index.json") {
      return Promise.resolve(Response.json(INDEX));
    }
    const body = DOCUMENTS[name];
    if (body !== undefined) {
      return Promise.resolve(Response.json(body));
    }
    return Promise.resolve(new Response("<Error/>", { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const config: RuntimeConfig = { environment: "dev", appVersion: "abc1234" };

function mount(path: string, runtime: RuntimeConfig = config) {
  return render(
    <RuntimeConfigProvider config={runtime}>
      <MemoryRouter initialEntries={[path]}>
        <SiteRoutes />
      </MemoryRouter>
    </RuntimeConfigProvider>,
  );
}

describe("home", () => {
  it("lists what is published in the reader's language and keeps the language on every link", async () => {
    stubApi();
    mount("/?lang=ru");

    const privacy = await screen.findByRole("link", {
      name: "Политика конфиденциальности",
    });
    expect(privacy).toHaveAttribute("href", "/privacy?lang=ru");
    // Not published in Russian, so the English edition is listed rather
    // than nothing.
    expect(screen.getByRole("link", { name: "Terms of Use" })).toHaveAttribute(
      "href",
      "/terms?lang=ru",
    );
    expect(screen.getByRole("heading", { name: "Документы" })).toBeVisible();
    expect(document.documentElement.lang).toBe("ru");
    expect(document.title).toBe("Country Flags");
  });

  it("says which stand this is unless it is production", async () => {
    stubApi();
    mount("/");
    await screen.findByRole("link", { name: "Privacy Policy" });
    expect(screen.getByText("dev stand")).toBeVisible();
    expect(document.documentElement.lang).toBe("en");
  });

  it("keeps quiet about the stand in production", async () => {
    stubApi();
    mount("/", { environment: "prod", appVersion: "sha256:abc" });
    await screen.findByRole("link", { name: "Privacy Policy" });
    expect(screen.queryByText("dev stand")).toBeNull();
  });

  it("offers a retry when the snapshot cannot be read", async () => {
    let attempts = 0;
    const fetchMock = stubApi({
      "index.json": () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new TypeError("Failed to fetch"))
          : Promise.resolve(Response.json(INDEX));
      },
    });
    mount("/");
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The page could not be loaded",
    );
    fireEvent.click(retry);
    await screen.findByRole("link", { name: "Privacy Policy" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("document", () => {
  it("renders the published html with a localized date, and names the tab", async () => {
    stubApi();
    mount("/privacy?lang=ru");

    await screen.findByRole("heading", {
      level: 1,
      name: "Политика конфиденциальности",
    });
    expect(screen.getByText("Написано по тому, что делает код.")).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 2, name: "Учётные записи" }),
    ).toBeVisible();
    expect(screen.getByText("Обновлено 15 сентября 2026 г.")).toBeVisible();
    expect(document.documentElement.lang).toBe("ru");
    expect(document.title).toBe("Country Flags — Политика конфиденциальности");
    // The way back keeps the reader's language.
    expect(screen.getByRole("link", { name: /Country Flags/ })).toHaveAttribute(
      "href",
      "/?lang=ru",
    );
    // The other published document is offered, in the English edition it exists in.
    expect(screen.getByRole("link", { name: "Terms of Use" })).toHaveAttribute(
      "href",
      "/terms?lang=ru",
    );
  });

  it("serves the English edition, in English chrome, when the reader's is not published", async () => {
    stubApi();
    mount("/terms?lang=ru");
    await screen.findByRole("heading", { level: 1, name: "Terms of Use" });
    expect(screen.getByText("Last updated September 15, 2026")).toBeVisible();
    expect(document.documentElement.lang).toBe("en");
  });

  it("says when there is no such document", async () => {
    stubApi();
    mount("/cookies");
    await screen.findByRole("heading", { name: "There is no such document" });
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("does not even ask for an address that is not a document", async () => {
    const fetchMock = stubApi();
    mount("/Privacy");
    await screen.findByRole("heading", { name: "There is no such document" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers a retry when the document cannot be read", async () => {
    let attempts = 0;
    stubApi({
      "privacy.en.json": () => {
        attempts += 1;
        return attempts === 1
          ? Promise.resolve(new Response("", { status: 503 }))
          : Promise.resolve(Response.json(DOCUMENTS["privacy.en.json"]));
      },
    });
    mount("/privacy");
    const retry = await screen.findByRole("button", { name: "Try again" });
    fireEvent.click(retry);
    await screen.findByRole("heading", { level: 1, name: "Privacy Policy" });
    expect(screen.getByText("Written from what the code does.")).toBeVisible();
  });
});
