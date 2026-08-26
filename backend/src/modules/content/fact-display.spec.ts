import { FactType } from "@prisma/client";

import {
  factDetails,
  factDisplayValue,
  mapBackSideFacts,
} from "./fact-display";

describe("fact display values", () => {
  it("names the official capital in the language asked for", () => {
    const value = [{ names: { en: "Bern", ru: "Берн" }, role: "official" }];

    expect(factDisplayValue(FactType.CAPITAL, value, "en")).toBe("Bern");
    expect(factDisplayValue(FactType.CAPITAL, value, "ru")).toBe("Берн");
  });

  it("falls back to English when the capital has no name in the reader's locale", () => {
    expect(
      factDisplayValue(
        FactType.CAPITAL,
        [{ names: { en: "Bern" }, role: "official" }],
        "ru",
      ),
    ).toBe("Bern");
  });

  /// Releases published before the seat carried a name map are still served.
  /// A reader must not meet an empty card because their content predates it.
  it("still reads a capital published under the older shape", () => {
    expect(
      factDisplayValue(
        FactType.CAPITAL,
        [{ name: "Paris", role: "official" }],
        "ru",
      ),
    ).toBe("Paris");
  });

  it("lists every official seat of a country that has more than one", () => {
    expect(
      factDisplayValue(
        FactType.CAPITAL,
        [
          { names: { en: "Pretoria" }, role: "official" },
          { names: { en: "Cape Town" }, role: "official" },
          { names: { en: "Somewhere" }, role: "former" },
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
    // CLDR gives the Russian common noun in its dictionary form. On the back
    // of a card it is a label, and a label starts with a capital in both
    // languages or the same card looks unfinished in one of them.
    expect(factDisplayValue(FactType.CURRENCY, value, "ru")).toBe("Евро (EUR)");
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

  it("names a language from the name the release published", () => {
    const value = [
      {
        code: "fr",
        names: { en: "French", ru: "французский" },
        role: "official_or_common",
      },
    ];

    expect(factDisplayValue(FactType.LANGUAGE, value, "en")).toBe("French");
    expect(factDisplayValue(FactType.LANGUAGE, value, "ru")).toBe(
      "Французский",
    );
  });

  /// Every entry, not only the first: English capitalises each language name
  /// lexically, and a list that capitalised one of them would read as a
  /// sentence rather than as the row of labels it is.
  it("capitalises every name in a list of several", () => {
    const value = [
      {
        code: "de",
        names: { ru: "немецкий", en: "German" },
        role: "official_or_common",
      },
      {
        code: "fr",
        names: { ru: "французский", en: "French" },
        role: "official_or_common",
      },
      {
        code: "it",
        names: { ru: "итальянский", en: "Italian" },
        role: "official_or_common",
      },
    ];

    expect(factDisplayValue(FactType.LANGUAGE, value, "ru")).toBe(
      "Немецкий, Французский, Итальянский",
    );
  });

  /// A name the source already capitalised is passed through untouched, so
  /// nothing here can quietly respell what a source said.
  it("leaves a name that is already capitalised alone", () => {
    expect(
      factDisplayValue(
        FactType.CAPITAL,
        [{ names: { en: "Bern", ru: "Берн" }, role: "official" }],
        "ru",
      ),
    ).toBe("Берн");
  });

  /// What the release says wins over what the runtime's tables would say, so
  /// two machines serving the same content cannot disagree about a card.
  it("prefers the published name over the platform's own", () => {
    expect(
      factDisplayValue(
        FactType.LANGUAGE,
        [{ code: "fr", names: { en: "Frankish" }, role: "official_or_common" }],
        "en",
      ),
    ).toBe("Frankish");
  });

  /// The shape releases published before the names were carried still render.
  it("names a language the older shape only gave a code for", () => {
    const value = [{ code: "fr", role: "official_or_common" }];

    expect(factDisplayValue(FactType.LANGUAGE, value, "en")).toBe("French");
    // The platform's tables spell it in lower case too, and a reader must not
    // be able to tell which of the two named it.
    expect(factDisplayValue(FactType.LANGUAGE, value, "ru")).toBe(
      "Французский",
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

  it("drops a language neither the release nor the platform can name", () => {
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
        // The older shape reads structurally too: what a client cannot do
        // with the line, it should not be denied because of the release's age.
        details: {
          kind: "capital",
          seats: [{ name: "Paris", role: "official" }],
        },
        observedAt: null,
        source,
      },
    ]);
  });

  it("carries the structured reading beside the line", () => {
    const facts = mapBackSideFacts(
      [
        {
          factType: FactType.CURRENCY,
          value: [
            {
              code: "NOK",
              names: { en: "Norwegian Krone", ru: "норвежская крона" },
              role: "legal_tender",
            },
          ],
          observedAt: null,
          source,
        },
      ],
      "en",
    );

    // Both: the line keeps older clients whole, the details let a screen
    // show the name without taking " (NOK)" off the end of prose.
    expect(facts[0]?.displayValue).toBe("Norwegian Krone (NOK)");
    expect(facts[0]?.details).toEqual({
      kind: "currency",
      tenders: [{ code: "NOK", name: "Norwegian Krone", role: "legal_tender" }],
    });
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

/**
 * The parts a screen needs, without the prose in between (#148). The
 * rendered line is a presentation decision — a separator, a code in
 * brackets — and a client that wanted the pieces used to take it apart with
 * a regular expression.
 */
describe("structured fact details", () => {
  it("gives a currency its code and its name apart", () => {
    const value = [
      {
        code: "NOK",
        names: { en: "Norwegian Krone", ru: "норвежская крона" },
        role: "legal_tender",
      },
      { code: "EUR", names: { en: "Euro" }, role: "legal_tender" },
    ];

    expect(factDetails(FactType.CURRENCY, value, "ru")).toEqual({
      kind: "currency",
      tenders: [
        { code: "NOK", name: "Норвежская крона", role: "legal_tender" },
        // Named in English only, and the reader asked for Russian: the code
        // stands in, exactly as the rendered line does. A currency has one
        // to fall back to; a capital does not, which is why that falls back
        // to English instead.
        { code: "EUR", name: "EUR", role: "legal_tender" },
      ],
    });
  });

  it("falls back to the code when the release never named the tender", () => {
    const details = factDetails(FactType.CURRENCY, [{ code: "XCD" }], "en");

    expect(details).toEqual({
      kind: "currency",
      tenders: [{ code: "XCD", name: "XCD", role: null }],
    });
  });

  it("lists the official seats of a capital", () => {
    const value = [
      { names: { en: "Pretoria" }, role: "official" },
      { names: { en: "Cape Town" }, role: "legislative" },
    ];

    expect(factDetails(FactType.CAPITAL, value, "en")).toEqual({
      kind: "capital",
      seats: [{ name: "Pretoria", role: "official" }],
    });
  });

  it("keeps a population as a number and its year", () => {
    expect(
      factDetails(FactType.POPULATION, { value: 5_425_000, year: 2024 }, "ru"),
    ).toEqual({ kind: "population", value: 5_425_000, year: 2024 });
  });

  it("names languages and keeps their tags", () => {
    const value = [{ code: "nb", names: { en: "Norwegian Bokmål" } }];

    expect(factDetails(FactType.LANGUAGE, value, "en")).toEqual({
      kind: "language",
      languages: [{ code: "nb", name: "Norwegian Bokmål" }],
    });
  });

  it("offers nothing structured for a value a publisher rendered itself", () => {
    const value = { displayValue: "Something only a human could phrase" };

    expect(factDetails(FactType.CURRENCY, value, "en")).toBeNull();
    // The line still arrives: that is what the escape hatch is for.
    expect(factDisplayValue(FactType.CURRENCY, value, "en")).toBe(
      "Something only a human could phrase",
    );
  });

  it("offers nothing structured for a shape it does not model", () => {
    expect(factDetails(FactType.CURRENCY, [{ notACode: 1 }], "en")).toBeNull();
  });
});
