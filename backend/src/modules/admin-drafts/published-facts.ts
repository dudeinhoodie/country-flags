import { FactType, type Prisma } from "@prisma/client";

/**
 * What the active release already says about an entity, in the shape the
 * entity editor's fields are in.
 *
 * The console shows these as placeholders beside the draft's own values, the
 * way it already does for names: an editor opening a state should see the
 * capital the release serves rather than an empty box, without the draft
 * quietly adopting it. Nothing here is ever written back — a fact the draft
 * does not carry keeps falling back to the release at build time, and
 * prefilling the field would turn every inherited fact into an override
 * somebody has to review.
 *
 * The published shapes are not the editor's shapes. A capital is stored as a
 * list of seats with a name map, population as a count with the year it was
 * counted in; the editor holds a locale map and a measured value. So this
 * translates rather than copies, and — following `fact-display`, which is the
 * other reader of these values — a shape it does not recognise yields nothing
 * rather than its own JSON. A placeholder that showed a reader
 * `[{"names":{...}}]` would be worse than an empty field.
 */
export interface PublishedFactRow {
  factType: FactType;
  value: Prisma.JsonValue;
  unit: string | null;
  observedAt: Date | null;
}

/** Locale → the value in that locale, as `AdminEntityLocalizedValue`. */
export type LocalizedValue = Record<string, string>;

export interface MeasuredValue {
  /** A number, as `AdminEntityMeasuredValue` has it. The editor's own field
   * holds a string, so the console renders this rather than adopting it. */
  value: number;
  unit?: string;
  observedAt?: string;
}

export interface PublishedFacts {
  capital?: LocalizedValue;
  largestCity?: LocalizedValue;
  motto?: LocalizedValue;
  statehoodDate?: string;
  population?: MeasuredValue;
  area?: MeasuredValue;
  languages?: LocalizedValue[];
}

const LOCALIZED: ReadonlyMap<FactType, keyof PublishedFacts> = new Map([
  [FactType.CAPITAL, "capital"],
  [FactType.LARGEST_CITY, "largestCity"],
  [FactType.MOTTO, "motto"],
]);

export function publishedFactsOf(rows: PublishedFactRow[]): PublishedFacts {
  const facts: PublishedFacts = {};
  for (const row of rows) {
    const localizedKey = LOCALIZED.get(row.factType);
    if (localizedKey !== undefined) {
      const value = localized(row.value);
      if (value !== null) {
        facts[localizedKey] = value as never;
      }
      continue;
    }
    switch (row.factType) {
      case FactType.POPULATION: {
        const measured = measure(row);
        if (measured !== null) {
          facts.population = measured;
        }
        break;
      }
      case FactType.AREA: {
        const measured = measure(row);
        if (measured !== null) {
          facts.area = measured;
        }
        break;
      }
      case FactType.STATEHOOD_DATE: {
        const date = dateOf(row);
        if (date !== null) {
          facts.statehoodDate = date;
        }
        break;
      }
      case FactType.LANGUAGE: {
        const languages = asArray(row.value)
          .map((entry) => localized(entry))
          .filter((entry): entry is LocalizedValue => entry !== null);
        if (languages.length > 0) {
          facts.languages = languages;
        }
        break;
      }
      default:
        // `CURRENCY` and `OTHER` have no field in the editor, so they have no
        // placeholder to fill. Listing them is how a new typed fact shows up
        // here as a decision rather than as silence.
        break;
    }
  }
  return facts;
}

/**
 * A localized value out of whichever shape the release published.
 *
 * Three are accepted because three exist: a list of entries carrying a name
 * map (a capital's seats), a single such entry, and a bare locale map. Where
 * several entries name the same locale they are joined the way a card back
 * joins them, so the placeholder reads as the release reads.
 */
function localized(value: Prisma.JsonValue | undefined): LocalizedValue | null {
  const entries = Array.isArray(value) ? value : [value];
  const byLocale = new Map<string, string[]>();
  for (const entry of entries) {
    for (const [locale, name] of Object.entries(nameMap(entry))) {
      byLocale.set(locale, [...(byLocale.get(locale) ?? []), name]);
    }
  }
  if (byLocale.size === 0) {
    return null;
  }
  return Object.fromEntries(
    [...byLocale].map(([locale, names]) => [locale, names.join(", ")]),
  );
}

/** The `names` map of an entry, or the entry itself when it is one. */
function nameMap(value: Prisma.JsonValue | undefined): LocalizedValue {
  if (!isRecord(value)) {
    return {};
  }
  // A seat that is not the official one is not what the editor's single field
  // is about, and `fact-display` drops it from the card for the same reason.
  const role = value["role"];
  if (typeof role === "string" && role !== "official") {
    return {};
  }
  const names = isRecord(value["names"]) ? value["names"] : value;
  return Object.fromEntries(
    Object.entries(names).filter(
      (pair): pair is [string, string] =>
        typeof pair[1] === "string" &&
        pair[1].length > 0 &&
        // `role`, `code` and friends sit beside the names in the bare shape.
        !["role", "code", "displayValue", "year", "value"].includes(pair[0]),
    ),
  );
}

/**
 * A measured value. The number may be the JSON itself or its `value` field;
 * the unit and the date come off the row, which is where the schema keeps
 * them, and `year` is accepted as the date when that is all there is.
 */
function measure(row: PublishedFactRow): MeasuredValue | null {
  const raw = isRecord(row.value) ? row.value["value"] : row.value;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return null;
  }
  const observed = dateOf(row);
  return {
    value: raw,
    ...(row.unit === null || row.unit.length === 0 ? {} : { unit: row.unit }),
    ...(observed === null ? {} : { observedAt: observed }),
  };
}

/** The row's date as `YYYY-MM-DD`, which is what the editor's input takes. */
function dateOf(row: PublishedFactRow): string | null {
  if (row.observedAt !== null) {
    return row.observedAt.toISOString().slice(0, 10);
  }
  const value = isRecord(row.value) ? row.value["date"] : row.value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/u.test(value)) {
    return value.slice(0, 10);
  }
  return null;
}

function asArray(value: Prisma.JsonValue): Prisma.JsonValue[] {
  return Array.isArray(value) ? value : [value];
}

function isRecord(
  value: Prisma.JsonValue | undefined,
): value is Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
