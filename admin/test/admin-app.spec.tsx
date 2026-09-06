import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApp } from "../src/app/AdminApp";
import type { RuntimeConfig } from "../src/config/runtime-config";
import { ADMIN_USER, stubAdminApi } from "./admin-api-stub";

const devConfig: RuntimeConfig = {
  environment: "dev",
  apiBasePath: "/api",
  googleClientId: "",
  appVersion: "abc1234",
  features: {},
};

describe("AdminApp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  it("opens on the Content workspace with the draft and environment in the bar", async () => {
    stubAdminApi();
    render(<AdminApp config={devConfig} />);
    expect(await screen.findByText("Content workspace")).toBeInTheDocument();
    expect(screen.getByText("DEV")).toBeInTheDocument();
    // The draft is shell state, not something a screen has to restate.
    expect(
      await screen.findByRole("button", { name: /Current draft/ }),
    ).toHaveTextContent("Draft 2026.09.01");
    expect(
      screen.getByRole("button", { name: "Search content" }),
    ).toBeInTheDocument();
  });

  it("marks prod so it cannot be mistaken for dev", async () => {
    stubAdminApi();
    render(<AdminApp config={{ ...devConfig, environment: "prod" }} />);
    expect(await screen.findByText("PROD")).toBeInTheDocument();
    expect(screen.queryByText("DEV")).not.toBeInTheDocument();
  });

  it("groups the navigation into published, draft, commerce and administration", async () => {
    stubAdminApi();
    render(<AdminApp config={devConfig} />);
    expect(await screen.findByText("Published content")).toBeInTheDocument();
    expect(screen.getByText("Draft workspace")).toBeInTheDocument();
    expect(screen.getByText("Commerce")).toBeInTheDocument();
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    // Everything the commerce section added stays reachable.
    for (const label of [
      "Offers",
      "Entitlements",
      "Store products",
      "Diagnostics",
    ]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
    expect(
      screen.getByRole("menuitem", { name: "Users & roles" }),
    ).toBeInTheDocument();
  });

  it("points the draft workspace section at the selected draft", async () => {
    stubAdminApi();
    render(<AdminApp config={devConfig} />);
    const deckBuilder = await screen.findByRole("menuitem", {
      name: "Deck builder",
    });
    expect(deckBuilder).toHaveAttribute(
      "href",
      "#/drafts/11111111-1111-4111-8111-111111111111/decks",
    );
  });

  it("shows the lifecycle, the work queue and a linked validation issue", async () => {
    stubAdminApi();
    render(<AdminApp config={devConfig} />);
    expect(
      await screen.findByRole("navigation", { name: "Draft lifecycle" }),
    ).toHaveTextContent("Edit content");
    const queue = await screen.findByRole("region", { name: /Work queue/ });
    // Ordered by how broken each deck is: the blocked one is first.
    const decks = within(queue).getAllByRole("heading", { level: 3 });
    expect(decks[0]).toHaveTextContent("Флаги штатов США");
    expect(decks[1]).toHaveTextContent("Гербы Европы");
    expect(within(queue).getByText("1 missing flags")).toBeInTheDocument();

    // A validation finding opens the object it names.
    const finding = await screen.findByRole("link", {
      name: /deck.us_states/,
    });
    expect(finding).toHaveAttribute(
      "href",
      "#/drafts/11111111-1111-4111-8111-111111111111/decks/deck.us_states",
    );
  });

  it("offers a draft when the deployment has none", async () => {
    stubAdminApi({ "/api/v1/admin/content/drafts": { items: [], total: 0 } });
    render(<AdminApp config={devConfig} />);
    expect(await screen.findByText("No draft is open")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create draft from current release" }),
    ).toBeInTheDocument();
    // With no draft there is nothing to point the editing section at.
    expect(
      screen.queryByRole("menuitem", { name: "Deck builder" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Create a draft" }),
    ).toBeInTheDocument();
  });

  it("does not invite a viewer to create a draft", async () => {
    stubAdminApi({
      "/api/v1/admin/me": { ...ADMIN_USER, role: "VIEWER" },
      "/api/v1/admin/content/drafts": { items: [], total: 0 },
    });
    render(<AdminApp config={devConfig} />);
    expect(await screen.findByText("No draft is open")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Create draft from current release",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Users & roles" }),
    ).not.toBeInTheDocument();
  });
});
