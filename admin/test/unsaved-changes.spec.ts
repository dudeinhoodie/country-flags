import { describe, expect, it } from "vitest";
import { shouldConfirmLeaving } from "../src/app/UnsavedChanges";

const INDIA = "/drafts/d1/entities/country.india";

describe("shouldConfirmLeaving", () => {
  it("says nothing while the form is clean", () => {
    expect(
      shouldConfirmLeaving(
        { dirty: false, within: INDIA },
        INDIA,
        "/drafts/d1/decks",
      ),
    ).toBe(false);
  });

  it("asks when a dirty editor is being left", () => {
    expect(
      shouldConfirmLeaving(
        { dirty: true, within: INDIA },
        INDIA,
        "/drafts/d1/decks",
      ),
    ).toBe(true);
  });

  it("does not ask when moving between the tabs of one editor", () => {
    expect(
      shouldConfirmLeaving(
        { dirty: true, within: INDIA },
        `${INDIA}/overview`,
        `${INDIA}/facts`,
      ),
    ).toBe(false);
  });

  // The bug this guards: `country.india` is a prefix of `country.indonesia`,
  // and both are real catalog keys. A `startsWith` that ignored the segment
  // boundary would let one country's unsaved edits be replaced by another's
  // without a word.
  it("asks when the next address merely starts with this one", () => {
    expect(
      shouldConfirmLeaving(
        { dirty: true, within: INDIA },
        INDIA,
        "/drafts/d1/entities/country.indonesia",
      ),
    ).toBe(true);
    expect(
      shouldConfirmLeaving(
        { dirty: true, within: "/drafts/d1/decks/deck.europe" },
        "/drafts/d1/decks/deck.europe",
        "/drafts/d1/decks/deck.europe-capitals",
      ),
    ).toBe(true);
  });

  it("never asks about staying where you are", () => {
    expect(
      shouldConfirmLeaving({ dirty: true, within: INDIA }, INDIA, INDIA),
    ).toBe(false);
  });

  // A screen that has not claimed an address is left wholesale.
  it("asks for any move when no editor claimed an address", () => {
    expect(
      shouldConfirmLeaving({ dirty: true, within: "" }, "/a", "/a/b"),
    ).toBe(true);
  });
});
