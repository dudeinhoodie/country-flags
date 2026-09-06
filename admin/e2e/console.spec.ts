import { expect, test } from "@playwright/test";
import { ADMIN_USER, DRAFT_ID, stubApi } from "./stub";

/**
 * Drives the console the way an operator does: through the browser, against
 * the shared stub of the admin API.
 */

test("opens on the workspace and says what is live and what is being edited", async ({
  page,
}) => {
  await stubApi(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Content workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Draft lifecycle" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Current draft/ }),
  ).toContainText("Draft fixture-v1");
  await expect(page.getByRole("region", { name: /Work queue/ })).toContainText(
    "Океания",
  );
});

test("marks the environment, and prod unmistakably", async ({ page }) => {
  await stubApi(page);
  await page.goto("/");
  // The badge names the deployment the mock runtime config declares.
  await expect(page.getByText("LOCAL", { exact: true })).toBeVisible();

  // The same console pointed at production says so before anything else is
  // read (ADR-014). The runtime config is what decides it, so that is what
  // the test changes.
  await page.route("**/config.json", async (route) => {
    await route.fulfill({
      json: {
        environment: "prod",
        apiBasePath: "/api",
        googleClientId: "",
        appVersion: "e2e",
      },
    });
  });
  await page.goto("/");
  await expect(page.getByText("PROD", { exact: true })).toBeVisible();
  await expect(page.getByText("LOCAL", { exact: true })).toHaveCount(0);
});

test("moves the summary panels into a drawer on a tablet", async ({ page }) => {
  await stubApi(page);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/");
  const summary = page.getByRole("region", { name: "Validation summary" });
  await expect(summary).toBeHidden();
  await page.getByRole("button", { name: "Summary" }).click();
  await expect(summary).toBeVisible();
});

test("lists published countries and decks, read-only", async ({ page }) => {
  await stubApi(page);
  await page.goto("/#/published/entities");
  await expect(page.getByText("Франция")).toBeVisible();
  await expect(page.getByText("Published · read-only")).toBeVisible();

  await page.goto("/#/published/decks");
  await expect(page.getByText("All countries")).toBeVisible();
});

test("sends a bookmark from before the redesign to the screen it became", async ({
  page,
}) => {
  await stubApi(page);
  await page.goto("/#/entities");
  await expect(page).toHaveURL(/#\/published\/entities$/);

  await page.goto(`/#/drafts/${DRAFT_ID}`);
  await expect(page).toHaveURL(new RegExp(`#/drafts/${DRAFT_ID}/overview$`));

  await page.goto(`/#/drafts/${DRAFT_ID}/assets`);
  await expect(page).toHaveURL(new RegExp(`#/drafts/${DRAFT_ID}/media$`));
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
  await expect(
    page.getByRole("heading", { level: 1, name: "Content workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Users & roles" }),
  ).toHaveCount(0);
});

test("blocks startup when the runtime config is unusable", async ({ page }) => {
  await page.route("**/config.json", async (route) => {
    await route.fulfill({ status: 500, body: "broken" });
  });
  await page.goto("/");
  await expect(page.getByText("The admin console cannot start")).toBeVisible();
});

test("asks before leaving an editor with unwritten changes", async ({
  page,
}) => {
  await stubApi(page);
  await page.goto(`/#/drafts/${DRAFT_ID}/entities/country.france`);
  const isoAlpha3 = page.getByRole("textbox", { name: "isoAlpha3" });
  await expect(isoAlpha3).toBeVisible();
  await isoAlpha3.fill("FRA");
  await expect(page.getByText("Unsaved changes.")).toBeVisible();

  // Leaving is done through the shell, which the editor cannot see: the
  // guard lives in the layout, and the menu is the ordinary way out.
  await page.getByRole("menuitem", { name: "Deck builder" }).click();
  const dialog = page.getByRole("dialog", { name: "Leave without saving?" });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(
    new RegExp(`#/drafts/${DRAFT_ID}/entities/country.france`),
  );
  await expect(isoAlpha3).toHaveValue("FRA");

  await page.getByRole("menuitem", { name: "Deck builder" }).click();
  await page.getByRole("button", { name: "Discard changes and leave" }).click();
  await expect(page).toHaveURL(new RegExp(`#/drafts/${DRAFT_ID}/decks$`));
});

test("a validation finding opens the object, the tab and the field", async ({
  page,
}) => {
  await stubApi(page);
  await page.goto("/");
  await page
    .getByRole("link", { name: /The deck resolves to only 4 countries/ })
    .click();

  await expect(page).toHaveURL(/#\/drafts\/.*\/decks\/deck\.oceania\/content/);
  await expect(
    page.getByRole("tab", { name: "Cards", selected: true }),
  ).toBeVisible();
  // The pointer names the member list, and that is where focus lands.
  await expect(
    page.locator('[data-field="/members"] button').first(),
  ).toBeFocused();
});

test("a deck can be put in order from the keyboard alone", async ({ page }) => {
  await stubApi(page);
  await page.goto(`/#/drafts/${DRAFT_ID}/decks/deck.oceania/content`);
  const members = page.locator('[data-field="/members"] li');
  // The entity list arrives after the deck, so the row's name settles from
  // the key to the published name; either way it is France that is first.
  await expect(members.first()).toContainText(/France|Франция/);

  const down = page.getByRole("button", {
    name: "Move country.france#FLAG_TO_COUNTRY@1 down",
  });
  await down.focus();
  await page.keyboard.press("Alt+ArrowDown");

  await expect(members.first()).toContainText("country.fiji");
  // Focus follows the card rather than falling back to the document.
  await expect(
    page.getByRole("button", {
      name: "Move country.france#FLAG_TO_COUNTRY@1 up",
    }),
  ).toBeFocused();
});

test("groups the release diff the way a reviewer reads it", async ({
  page,
}) => {
  await stubApi(page);
  await page.goto(`/#/drafts/${DRAFT_ID}/release`);
  await expect(page.getByRole("region", { name: "Membership" })).toContainText(
    "Countries: 4 → 5",
  );
  await expect(page.getByRole("region", { name: "Access" })).toContainText(
    "free → paid",
  );
  await expect(
    page.getByRole("region", { name: "Presentation" }),
  ).toContainText("Description (en) changed");
});

test("keeps the summary rail beside the work on a 1280px desktop", async ({
  page,
}) => {
  await stubApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Validation summary" }),
  ).toBeVisible();
  // The drawer's opener belongs to the narrow layout only.
  await expect(page.getByRole("button", { name: "Summary" })).toBeHidden();
});
