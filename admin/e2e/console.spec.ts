import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Drives the console the way an operator does: through the browser, against
 * a stub of the admin API. The stub exists because these tests are about
 * the console — whether the screens read what the API answers, whether
 * roles hide what they must, whether prod is unmistakable. Whether the API
 * answers correctly is what the backend's own integration suite proves, and
 * running both against one stack would make each failure ambiguous.
 */

const ADMIN_USER = {
  id: "8f1f9f76-1f0a-4a2e-9a5e-2b8f4f1c9d10",
  email: "root@country-flags.test",
  displayName: "root",
  role: "ADMIN",
  status: "ACTIVE",
  createdAt: "2026-08-24T09:00:00Z",
};

const DRAFT = {
  id: "11111111-1111-4111-8111-111111111111",
  baseContentVersion: "fixture-v1",
  baseCatalogCommit: "abc1234",
  schemaVersion: 1,
  revision: 3,
  status: "READY",
  proposalUrl: null,
  createdByAdminUserId: ADMIN_USER.id,
  updatedByAdminUserId: ADMIN_USER.id,
  createdAt: "2026-08-24T09:00:00Z",
  updatedAt: "2026-08-24T09:30:00Z",
  document: { decks: [], entities: [] },
  validationReport: {
    validatedAt: "2026-08-24T09:31:00Z",
    blocking: 0,
    warnings: 1,
    findings: [
      {
        level: "warning",
        code: "DECK_SMALL",
        subject: "deck.oceania",
        message: "The deck resolves to only 4 countries",
      },
    ],
  },
};

async function stubApi(
  page: Page,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const routes: Record<string, unknown> = {
    "/api/v1/admin/me": ADMIN_USER,
    "/api/v1/admin/content/status": {
      activeVersion: "fixture-v1",
      schemaVersion: 1,
      publishedAt: "2026-08-20T09:30:00Z",
      entityCount: 278,
      deckCount: 6,
    },
    "/api/v1/admin/content/entities": {
      items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
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
          contentVersion: "fixture-v1",
        },
      ],
      total: 1,
    },
    "/api/v1/admin/content/decks": {
      items: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          code: "ALL",
          kind: "CURATED",
          status: "PUBLISHED",
          cardCount: 250,
          nameRu: "Все страны",
          nameEn: "All countries",
          contentVersion: "fixture-v1",
        },
      ],
      total: 1,
    },
    "/api/v1/admin/content/drafts": { items: [DRAFT], total: 1 },
    ...overrides,
  };

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const body = routes[path];
    if (body !== undefined) {
      await route.fulfill({ json: body });
      return;
    }
    await route.fulfill({
      status: 404,
      json: {
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: `no stub for ${path}`,
          requestId: ADMIN_USER.id,
          details: {},
        },
      },
    });
  });
}

test("signs the operator in and shows the active release", async ({ page }) => {
  await stubApi(page);
  await page.goto("/");
  await expect(page.getByText("Catalog administration")).toBeVisible();
  await expect(page.getByText("fixture-v1")).toBeVisible();
  await expect(page.getByText("278", { exact: true })).toBeVisible();
  await expect(page.getByText("6", { exact: true })).toBeVisible();
});

test("marks the environment, and prod unmistakably", async ({ page }) => {
  await stubApi(page);
  await page.goto("/");
  await expect(page.getByText("DEV")).toBeVisible();
});

test("lists published countries and decks", async ({ page }) => {
  await stubApi(page);
  await page.goto("/#/entities");
  await expect(page.getByText("Франция")).toBeVisible();

  await page.goto("/#/decks");
  await expect(page.getByText("All countries")).toBeVisible();
});

test("shows the roster only to an admin", async ({ page }) => {
  await stubApi(page, {
    "/api/v1/admin/users": { items: [ADMIN_USER], total: 1 },
  });
  await page.goto("/#/users");
  await expect(page.getByText("root@country-flags.test")).toBeVisible();
});

test("hides access management from an editor", async ({ page }) => {
  await stubApi(page, {
    "/api/v1/admin/me": { ...ADMIN_USER, role: "EDITOR" },
  });
  await page.goto("/");
  await expect(page.getByText("Catalog administration")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Access" })).toHaveCount(0);
});

test("blocks startup when the runtime config is unusable", async ({ page }) => {
  await page.route("**/config.json", async (route) => {
    await route.fulfill({ status: 500, body: "broken" });
  });
  await page.goto("/");
  await expect(page.getByText("The admin console cannot start")).toBeVisible();
});
