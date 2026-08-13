import { DECK_CODE_PATTERN, deckCodeFromKey } from "./bundle-mapper";

describe("deckCodeFromKey", () => {
  it("serves a deck key in the alphabet the contract requires", () => {
    expect(deckCodeFromKey("deck.all")).toBe("ALL");
    expect(deckCodeFromKey("deck.europe")).toBe("EUROPE");
  });

  it("keeps a multi-word key readable rather than running it together", () => {
    expect(deckCodeFromKey("deck.historical-states")).toBe("HISTORICAL_STATES");
    expect(deckCodeFromKey("deck.south.america")).toBe("SOUTH_AMERICA");
  });

  // The derivation is the whole compatibility story between a published deck
  // and the mock the iOS build reads, so what it produces is checked against
  // the contract rather than assumed to satisfy it.
  it("produces codes the contract accepts", () => {
    for (const key of [
      "deck.all",
      "deck.europe",
      "deck.historical-states",
      "deck.a1",
    ]) {
      expect(deckCodeFromKey(key)).toMatch(DECK_CODE_PATTERN);
    }
  });

  it("does not invent a code for a key that cannot have one", () => {
    // A leading digit has no upper case, and the contract requires a letter.
    // Rejecting is the validator's job; the derivation reports honestly.
    expect(deckCodeFromKey("deck.1990s")).not.toMatch(DECK_CODE_PATTERN);
  });
});
