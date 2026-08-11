import { FactType, type Prisma } from "@prisma/client";

/**
 * Turns a stored fact value into the line that goes on the back of a card.
 *
 * The pipeline publishes facts as structured values — a capital is a list of
 * named seats, a population is a number and the year it was counted — because
 * that is what the sources say and what a later consumer can reason about.
 * Rendering happens here, on the read path, because it needs the locale the
 * request asked for: a population is grouped differently in every language and
 * a currency or a language has a name in each of them.
 *
 * A value whose shape is not recognised yields null rather than its own JSON.
 * A card that says nothing about a country's capital is a gap; one that says
 * `[{"name":"Kabul","role":"official"}]` is a defect on screen.
 */
export function factDisplayValue(
  factType: FactType,
  value: Prisma.JsonValue,
  locale: string,
): string | null {
  // A publisher that supplied a rendered value keeps it: that is the escape
  // hatch for a fact no rule here can shape.
  const supplied = suppliedDisplayValue(value);
  if (supplied !== null) {
    return supplied;
  }
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }

  switch (factType) {
    case FactType.CAPITAL:
      return capital(value);
    case FactType.POPULATION:
      return population(value, locale);
    case FactType.CURRENCY:
      return currency(value, locale);
    case FactType.LANGUAGE:
      return language(value, locale);
    default:
      return null;
  }
}

function suppliedDisplayValue(value: Prisma.JsonValue): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const supplied = value["displayValue"];
  return typeof supplied === "string" && supplied.length > 0 ? supplied : null;
}

/** `[{ name, role }]` — the official seats, in the order published. */
function capital(value: Prisma.JsonValue): string | null {
  const seats = asArray(value)
    .filter(isRecord)
    .filter((seat) => seat["role"] === undefined || seat["role"] === "official")
    .map((seat) => seat["name"])
    .filter((name): name is string => typeof name === "string");
  return join(seats);
}

/**
 * `{ value, year }` — the count, grouped for the reader, followed by the year
 * it belongs to. The year is part of the sentence rather than the record's
 * `observedAt`: the source reports which year it counted, not the day.
 */
function population(value: Prisma.JsonValue, locale: string): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const count = value["value"];
  if (typeof count !== "number" || !Number.isFinite(count)) {
    return null;
  }
  const formatted = new Intl.NumberFormat(locale).format(count);
  const year = value["year"];
  return typeof year === "number" ? `${formatted} (${String(year)})` : formatted;
}

/**
 * `[{ code, names, role }]` — the tender in the reader's language, with the
 * code, which is what a traveller actually sees printed.
 */
function currency(value: Prisma.JsonValue, locale: string): string | null {
  const tenders = asArray(value)
    .filter(isRecord)
    .filter(
      (entry) =>
        entry["role"] === undefined || entry["role"] === "legal_tender",
    )
    .map((entry) => {
      const code = entry["code"];
      if (typeof code !== "string") {
        return null;
      }
      const name = localizedName(entry["names"], locale);
      return name === null ? code : `${name} (${code})`;
    })
    .filter((entry): entry is string => entry !== null);
  return join(tenders);
}

/** `[{ code, role }]` — the language named in the reader's own. */
function language(value: Prisma.JsonValue, locale: string): string | null {
  const names = new Intl.DisplayNames([locale], {
    type: "language",
    fallback: "none",
  });
  const languages = asArray(value)
    .filter(isRecord)
    .map((entry) => entry["code"])
    .filter((code): code is string => typeof code === "string")
    // A code the platform cannot name is dropped rather than printed raw:
    // "fr" on the back of a card is not an answer to what is spoken there.
    .map((code) => safeDisplayName(names, code))
    .filter((name): name is string => name !== null);
  return join(languages);
}

function safeDisplayName(names: Intl.DisplayNames, code: string): string | null {
  try {
    return names.of(code) ?? null;
  } catch {
    // `of` throws on a malformed tag rather than returning undefined.
    return null;
  }
}

function localizedName(names: Prisma.JsonValue | undefined, locale: string): string | null {
  if (!isRecord(names)) {
    return null;
  }
  for (const candidate of [locale, locale.split("-")[0] ?? locale]) {
    const name = names[candidate];
    if (typeof name === "string" && name.length > 0) {
      return name;
    }
  }
  return null;
}

function join(values: string[]): string | null {
  return values.length > 0 ? values.join(", ") : null;
}

function asArray(value: Prisma.JsonValue): Prisma.JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(
  value: Prisma.JsonValue | undefined,
): value is Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The stored shape the three read paths share. */
interface StoredFact {
  factType: FactType;
  value: Prisma.JsonValue;
  observedAt: Date | null;
  source: { name: string; url: string | null };
}

/**
 * The facts of one entity, as the contract's `backSideFacts`.
 *
 * A fact that cannot be rendered in this locale is left out. It is a fact the
 * client would have had nothing to show for, and an entry whose displayValue
 * is a stringified record is worse than an absent one.
 */
export function mapBackSideFacts(
  facts: StoredFact[],
  locale: string,
): Array<{
  type: FactType;
  displayValue: string;
  observedAt: string | null;
  source: { name: string; url: string | null };
}> {
  return facts.flatMap((fact) => {
    const displayValue = factDisplayValue(fact.factType, fact.value, locale);
    if (displayValue === null) {
      return [];
    }
    return [
      {
        type: fact.factType,
        displayValue,
        observedAt:
          fact.observedAt === null
            ? null
            : fact.observedAt.toISOString().slice(0, 10),
        source: { name: fact.source.name, url: fact.source.url },
      },
    ];
  });
}
