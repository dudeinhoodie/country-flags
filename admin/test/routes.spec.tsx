import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApp } from "../src/app/AdminApp";
import { legacyRoutes, routes } from "../src/app/routes";
import type { RuntimeConfig } from "../src/config/runtime-config";
import {
  DRAFT_ID,
  PUBLISHED_DECK_ID,
  PUBLISHED_ENTITY_ID,
  stubAdminApi,
} from "./admin-api-stub";

const devConfig: RuntimeConfig = {
  environment: "dev",
  apiBasePath: "/api",
  googleClientId: "",
  appVersion: "abc1234",
  features: {},
};

function open(path: string, overrides: Record<string, unknown> = {}): void {
  stubAdminApi(overrides);
  window.location.hash = `#${path}`;
  render(<AdminApp config={devConfig} />);
}

describe("routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  describe("the addresses the redesign introduced", () => {
    it("serves the published countries read-only", async () => {
      open(routes.publishedEntities);
      expect(
        await screen.findByRole("heading", {
          level: 1,
          name: "Countries & regions",
        }),
      ).toBeInTheDocument();
      // The surface says what it is, so a published list cannot be taken
      // for an editable draft.
      expect(
        await screen.findByText(/Published · read-only/),
      ).toBeInTheDocument();
      expect(await screen.findByText("Франция")).toBeInTheDocument();
    });

    it("serves one published country", async () => {
      open(routes.publishedEntity(PUBLISHED_ENTITY_ID), {
        [`/api/v1/admin/content/entities/${PUBLISHED_ENTITY_ID}`]: {
          id: PUBLISHED_ENTITY_ID,
          contentKey: "country.france",
          slug: "france",
          kind: "COUNTRY",
          status: "ACTIVE",
          recognitionStatus: "UN_MEMBER",
          isoAlpha2: "FR",
          isoAlpha3: "FRA",
          nameRu: "Франция",
          nameEn: "France",
          flag: null,
          contentVersion: "2026.09.01",
          includeInCountryCatalog: true,
          names: [],
        },
      });
      expect(
        await screen.findByRole("heading", {
          level: 1,
          name: "Published country",
        }),
      ).toBeInTheDocument();
    });

    it("serves the published decks read-only", async () => {
      open(routes.publishedDecks);
      expect(
        await screen.findByRole("heading", { level: 1, name: "Decks" }),
      ).toBeInTheDocument();
      expect(await screen.findByText("All countries")).toBeInTheDocument();
    });

    it("serves one published deck", async () => {
      open(routes.publishedDeck(PUBLISHED_DECK_ID), {
        [`/api/v1/admin/content/decks/${PUBLISHED_DECK_ID}`]: {
          id: PUBLISHED_DECK_ID,
          code: "ALL",
          kind: "CURATED",
          status: "PUBLISHED",
          cardCount: 250,
          nameRu: "Все страны",
          nameEn: "All countries",
          contentVersion: "2026.09.01",
          localizations: [],
          ruleSpec: null,
        },
      });
      expect(
        await screen.findByRole("heading", {
          level: 1,
          name: "Published deck",
        }),
      ).toBeInTheDocument();
    });

    it("serves the draft overview", async () => {
      open(routes.draftOverview(DRAFT_ID));
      expect(
        await screen.findByRole("heading", {
          level: 1,
          name: "Draft overview",
        }),
      ).toBeInTheDocument();
      expect(
        await screen.findByText(/Branched from content version 2026\.09\.01/),
      ).toBeInTheDocument();
    });

    it("serves the draft's decks", async () => {
      open(routes.draftDecks(DRAFT_ID));
      expect(
        await screen.findByRole("heading", { level: 1, name: "Deck builder" }),
      ).toBeInTheDocument();
      expect(
        await screen.findByText("deck.european_coats"),
      ).toBeInTheDocument();
    });

    it("serves the draft's media queue", async () => {
      open(routes.draftMedia(DRAFT_ID));
      expect(
        await screen.findByRole("heading", { level: 1, name: "Media" }),
      ).toBeInTheDocument();
    });

    it("serves validation and release", async () => {
      open(routes.draftRelease(DRAFT_ID));
      expect(
        await screen.findByRole("heading", {
          level: 1,
          name: "Validation & release",
        }),
      ).toBeInTheDocument();
      expect(await screen.findByText("Release readiness")).toBeInTheDocument();
    });

    it("accepts a tab segment on the entity editor, for a field-level link", async () => {
      open(`${routes.draftEntity(DRAFT_ID, "country.germany")}/media`, {
        [`/api/v1/admin/content/drafts/${DRAFT_ID}/entities/country.germany`]: {
          key: "country.germany",
          type: "country",
          status: "active",
          includeInCountryCatalog: true,
          recognitionStatus: "UN_MEMBER",
          identifiers: { isoAlpha2: "DE" },
          parentKey: null,
          overrideCount: 0,
          publishedName: "Германия",
          names: {},
          facts: {},
          overrides: {},
          assets: [],
        },
      });
      // The editor itself is #317/#318; the address has to resolve now so a
      // validation finding can already point at it.
      await waitFor(() => {
        expect(window.location.hash).toBe(
          `#${routes.draftEntity(DRAFT_ID, "country.germany")}/media`,
        );
      });
      expect(screen.queryByText("Not Found")).not.toBeInTheDocument();
    });
  });

  describe("the addresses the console used to serve", () => {
    it.each([
      ["#/entities", routes.publishedEntities],
      [
        `#/entities/${PUBLISHED_ENTITY_ID}/show`,
        routes.publishedEntity(PUBLISHED_ENTITY_ID),
      ],
      ["#/decks", routes.publishedDecks],
      [
        `#/decks/${PUBLISHED_DECK_ID}/show`,
        routes.publishedDeck(PUBLISHED_DECK_ID),
      ],
      [`#/drafts/${DRAFT_ID}`, routes.draftOverview(DRAFT_ID)],
      [`#/drafts/${DRAFT_ID}/assets`, routes.draftMedia(DRAFT_ID)],
    ])("sends %s to %s", async (from, to) => {
      stubAdminApi();
      window.location.hash = from;
      render(<AdminApp config={devConfig} />);
      await waitFor(() => {
        expect(window.location.hash).toBe(`#${to}`);
      });
    });

    it("covers every legacy route the table declares", () => {
      // The redirects are data, and the test walks the same table the app
      // renders, so a route added to one cannot be forgotten in the other.
      expect(legacyRoutes.map((legacy) => legacy.from)).toEqual([
        "/entities",
        "/entities/:id/show",
        "/decks",
        "/decks/:id/show",
        "/drafts/:draftId",
        "/drafts/:draftId/assets",
      ]);
    });
  });
});
