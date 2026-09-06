import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { DRAFT_ID, stubApi } from "./stub";

/**
 * WCAG 2.2 AA, checked on the screens an editor actually works in (§11).
 *
 * axe cannot prove a console is usable, and this suite does not pretend it
 * can: the keyboard paths are driven in `console.spec.ts`, where a deck is
 * reordered without a mouse and a finding is followed to the field it names.
 * What this catches is the class of mistake nobody notices by using the
 * product — an icon with no name, a control with no label, a contrast ratio
 * that fails on somebody else's monitor.
 *
 * The rule set is pinned to the WCAG 2.0/2.1/2.2 A and AA tags, so a new axe
 * release adds findings only where the standard did.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function scan(page: Page): Promise<void> {
  // A dialog fading in is measured mid-transition, and blended colours are
  // not the colours anybody sees. Waiting for the animations to finish is
  // what makes the contrast check about the design rather than the frame.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== "running"),
  );
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}

test.describe("accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await stubApi(page);
  });

  test("the content workspace", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Content workspace" }),
    ).toBeVisible();
    await scan(page);
  });

  test("the entity editor, on every tab", async ({ page }) => {
    for (const tab of ["overview", "names", "facts", "media", "usage"]) {
      await page.goto(`/#/drafts/${DRAFT_ID}/entities/country.france/${tab}`);
      await expect(page.getByRole("tabpanel")).toBeVisible();
      await scan(page);
    }
  });

  test("the deck builder, on every tab", async ({ page }) => {
    for (const tab of [
      "details",
      "content",
      "presentation",
      "access",
      "review",
    ]) {
      await page.goto(`/#/drafts/${DRAFT_ID}/decks/deck.oceania/${tab}`);
      await expect(page.getByRole("tabpanel")).toBeVisible();
      await scan(page);
    }
  });

  test("the media queue", async ({ page }) => {
    await page.goto(`/#/drafts/${DRAFT_ID}/media`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Media" }),
    ).toBeVisible();
    await scan(page);
  });

  test("validation and release", async ({ page }) => {
    await page.goto(`/#/drafts/${DRAFT_ID}/release`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Validation & release" }),
    ).toBeVisible();
    await scan(page);
  });

  // A dialog is where focus management goes wrong most quietly, so the two
  // the redesign adds are scanned open rather than closed.
  test("the unsaved-changes dialog", async ({ page }) => {
    await page.goto(`/#/drafts/${DRAFT_ID}/entities/country.france`);
    await page.getByRole("textbox", { name: "isoAlpha3" }).fill("FRA");
    await page.getByRole("menuitem", { name: "Deck builder" }).click();
    await expect(
      page.getByRole("dialog", { name: "Leave without saving?" }),
    ).toBeVisible();
    await scan(page);
  });

  test("the upload drawer, opened from a slot", async ({ page }) => {
    await page.goto(`/#/drafts/${DRAFT_ID}/entities/country.france/media`);
    await page.getByRole("button", { name: "Add flag" }).click();
    await expect(
      page.getByRole("dialog", { name: "Upload a Flag" }),
    ).toBeVisible();
    await scan(page);
  });
});
