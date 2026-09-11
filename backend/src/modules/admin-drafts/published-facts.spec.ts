import { FactType } from "@prisma/client";

import { publishedFactsOf, type PublishedFactRow } from "./published-facts";

function row(overrides: Partial<PublishedFactRow>): PublishedFactRow {
  return {
    factType: FactType.CAPITAL,
    value: null,
    unit: null,
    observedAt: null,
    ...overrides,
  };
}

describe("publishedFactsOf", () => {
  it("reads a capital out of the seats the release publishes", () => {
    const facts = publishedFactsOf([
      row({
        factType: FactType.CAPITAL,
        value: [
          { names: { en: "Sacramento", ru: "Сакраменто" }, role: "official" },
        ],
      }),
    ]);

    expect(facts.capital).toEqual({ en: "Sacramento", ru: "Сакраменто" });
  });

  it("keeps only the official seat, the way a card back does", () => {
    const facts = publishedFactsOf([
      row({
        factType: FactType.CAPITAL,
        value: [
          { names: { en: "Sacramento" }, role: "official" },
          { names: { en: "Los Angeles" }, role: "largest" },
        ],
      }),
    ]);

    expect(facts.capital).toEqual({ en: "Sacramento" });
  });

  it("joins several official seats per locale rather than picking one", () => {
    const facts = publishedFactsOf([
      row({
        factType: FactType.CAPITAL,
        value: [
          { names: { en: "Pretoria" }, role: "official" },
          { names: { en: "Cape Town" }, role: "official" },
        ],
      }),
    ]);

    expect(facts.capital).toEqual({ en: "Pretoria, Cape Town" });
  });

  it("accepts a bare locale map, which older releases carry", () => {
    const facts = publishedFactsOf([
      row({ factType: FactType.MOTTO, value: { en: "Eureka" } }),
    ]);

    expect(facts.motto).toEqual({ en: "Eureka" });
  });

  it("takes a measured value's unit and date off the row", () => {
    const facts = publishedFactsOf([
      row({
        factType: FactType.AREA,
        value: { value: 423967 },
        unit: "km2",
        observedAt: new Date("2024-01-15T00:00:00.000Z"),
      }),
    ]);

    expect(facts.area).toEqual({
      value: 423967,
      unit: "km2",
      observedAt: "2024-01-15",
    });
  });

  it("reports a population with no unit as a value alone", () => {
    const facts = publishedFactsOf([
      row({ factType: FactType.POPULATION, value: { value: 39538223 } }),
    ]);

    expect(facts.population).toEqual({ value: 39538223 });
  });

  it("reads a statehood date", () => {
    const facts = publishedFactsOf([
      row({
        factType: FactType.STATEHOOD_DATE,
        observedAt: new Date("1850-09-09T00:00:00.000Z"),
      }),
    ]);

    expect(facts.statehoodDate).toBe("1850-09-09");
  });

  it("keeps every language as its own localized row", () => {
    const facts = publishedFactsOf([
      row({
        factType: FactType.LANGUAGE,
        value: [
          { code: "en", names: { en: "English" } },
          { code: "es", names: { en: "Spanish" } },
        ],
      }),
    ]);

    expect(facts.languages).toEqual([{ en: "English" }, { en: "Spanish" }]);
  });

  it("yields nothing for a shape it does not recognise", () => {
    // The rule `fact-display` already follows: a placeholder showing raw JSON
    // would be worse than an empty field.
    const facts = publishedFactsOf([
      row({ factType: FactType.CAPITAL, value: 42 }),
      row({ factType: FactType.POPULATION, value: "many" }),
      row({ factType: FactType.AREA, value: { value: Number.NaN } }),
    ]);

    expect(facts).toEqual({});
  });

  it("ignores the fact types the editor has no field for", () => {
    const facts = publishedFactsOf([
      row({ factType: FactType.CURRENCY, value: [{ code: "USD" }] }),
      row({ factType: FactType.OTHER, value: { en: "something" } }),
    ]);

    expect(facts).toEqual({});
  });
});
