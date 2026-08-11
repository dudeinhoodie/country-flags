import { FactType } from "@prisma/client";

import { factDisplayValue, mapBackSideFacts } from "./fact-display";

describe("fact display values", () => {
  it("names the official capital rather than describing the seat", () => {
    expect(
      factDisplayValue(
        FactType.CAPITAL,
        [{ name: "Paris", role: "official" }],
        "en",
      ),
    ).toBe("Paris");
  });

  it("lists every official seat of a country that has more than one", () => {
    expect(
      factDisplayValue(
        FactType.CAPITAL,
        [
          { name: "Pretoria", role: "official" },
          { name: "Cape Town", role: "official" },
          { name: "Somewhere", role: "former" },
        ],
        "en",
      ),
    ).toBe("Pretoria, Cape Town");
  });

  it("groups a population for the reader and says which year it counts", () => {
    const value = { value: 68551653, year: 2024 };

    expect(factDisplayValue(FactType.POPULATION, value, "en")).toBe(
      "68,551,653 (2024)",
    );
    // The same number, grouped as the other release language writes it.
    expect(factDisplayValue(FactType.POPULATION, value, "ru")).toMatch(
      /^68\s?551\s?653 \(2024\)$/u,
    );
  });

  it("names the currency in the language asked for and keeps the code", () => {
    const value = [
      { code: "EUR", names: { en: "Euro", ru: "евро" }, role: "legal_tender" },
    ];

    expect(factDisplayValue(FactType.CURRENCY, value, "en")).toBe("Euro (EUR)");
    expect(factDisplayValue(FactType.CURRENCY, value, "ru")).toBe("евро (EUR)");
  });

  it("falls back to the code when the currency has no name in any candidate", () => {
    expect(
      factDisplayValue(
        FactType.CURRENCY,
        [{ code: "XAF", names: {}, role: "legal_tender" }],
        "en",
      ),
    ).toBe("XAF");
  });

  it("names a language in the reader's own language", () => {
    const value = [{ code: "fr", role: "official_or_common" }];

    expect(factDisplayValue(FactType.LANGUAGE, value, "en")).toBe("French");
    expect(factDisplayValue(FactType.LANGUAGE, value, "ru")).toBe(
      "французский",
    );
  });

  /// A rendered value published with the fact is the escape hatch for anything
  /// these rules cannot shape, so it wins.
  it("keeps a display value the publisher supplied", () => {
    expect(
      factDisplayValue(
        FactType.POPULATION,
        { value: 1, displayValue: "about a million" },
        "en",
      ),
    ).toBe("about a million");
  });

  /// The defect this exists to end: a card that reported its own database row.
  it("refuses to render a shape it does not recognise as its own JSON", () => {
    expect(
      factDisplayValue(FactType.CAPITAL, { unexpected: true }, "en"),
    ).toBeNull();
    expect(factDisplayValue(FactType.AREA, { value: 3 }, "en")).toBeNull();
    expect(
      factDisplayValue(FactType.POPULATION, { value: "many" }, "en"),
    ).toBeNull();
  });

  it("drops a language code the platform cannot name", () => {
    expect(
      factDisplayValue(FactType.LANGUAGE, [{ code: "zz-not-a-tag!" }], "en"),
    ).toBeNull();
  });
});

describe("back side facts", () => {
  const source = { name: "World Bank", url: "https://data.worldbank.org" };

  it("leaves out a fact it has nothing to show for", () => {
    const facts = mapBackSideFacts(
      [
        {
          factType: FactType.CAPITAL,
          value: [{ name: "Paris", role: "official" }],
          observedAt: null,
          source,
        },
        {
          factType: FactType.AREA,
          value: { squareKm: 551695 },
          observedAt: null,
          source,
        },
      ],
      "en",
    );

    expect(facts).toEqual([
      {
        type: FactType.CAPITAL,
        displayValue: "Paris",
        observedAt: null,
        source,
      },
    ]);
  });

  it("reports an observation date as a plain day", () => {
    const facts = mapBackSideFacts(
      [
        {
          factType: FactType.CAPITAL,
          value: [{ name: "Paris", role: "official" }],
          observedAt: new Date("2026-07-28T13:07:17.716Z"),
          source,
        },
      ],
      "en",
    );

    expect(facts[0]?.observedAt).toBe("2026-07-28");
  });
});
