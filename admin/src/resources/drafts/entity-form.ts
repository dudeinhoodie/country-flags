import type { UnsavedChange } from "../../components/ConflictDialog";
import type {
  DraftEntityDetail,
  EntityFacts,
  EntityUpdateBody,
} from "./useDraftEntities";

/**
 * The entity editor's form, apart from React.
 *
 * Seeding, assembling and comparing are pure functions over one value rather
 * than a dozen `useState` calls, because §9 asks three questions of a form
 * that a scattered state cannot answer: is it dirty, what exactly did this
 * editor change, and what does `Discard changes` restore. All three are the
 * same comparison, made once, here.
 */

export const ENTITY_TYPES = [
  "country",
  "territory",
  "area",
  "subdivision",
  "region",
  "subregion",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_STATUSES = [
  "active",
  "historical",
  "retired",
  "hidden",
] as const;

export type EntityStatus = (typeof ENTITY_STATUSES)[number];

/** What a subdivision may hang from: a state's part belongs to the state. */
export const PARENT_TYPES: readonly string[] = ["country", "territory"];

/**
 * A subdivision is not recognized or unrecognized — the question does not
 * apply — and the publisher pins the answer, so the field shows it rather
 * than inviting an edit the backend would overwrite (ADR-020).
 */
export const SUBDIVISION_RECOGNITION_STATUS = "not_applicable";

/**
 * Every identifier and what it is allowed to look like, mirroring the
 * editorial schema. The patterns are the point of having separate fields at
 * all: `US-CA` typed into an ISO country code would put a state everywhere
 * a reader expects a country.
 */
export const IDENTIFIERS: {
  key: string;
  pattern?: RegExp;
  maxLength?: number;
  expected: string;
}[] = [
  {
    key: "isoAlpha2",
    pattern: /^[A-Za-z]{2}$/,
    expected: "two letters, as in FR",
  },
  {
    key: "isoAlpha3",
    pattern: /^[A-Za-z]{3}$/,
    expected: "three letters, as in FRA",
  },
  { key: "m49", pattern: /^[0-9]{3}$/, expected: "three digits, as in 250" },
  {
    key: "isoSubdivision",
    pattern: /^[A-Za-z]{2}-[A-Za-z0-9]{1,3}$/,
    expected: "ISO 3166-2, as in US-CA",
  },
  { key: "localCode", maxLength: 40, expected: "at most 40 characters" },
  { key: "fipsCode", maxLength: 10, expected: "at most 10 characters" },
  { key: "wikidataId", expected: "a Wikidata id" },
  { key: "editorialKey", expected: "an editorial key" },
  { key: "customCode", expected: "a custom code" },
];

export const NAME_FIELDS = ["short", "official"] as const;

export const LOCALIZED_FACTS = [
  { key: "capital", label: "Capital" },
  { key: "largestCity", label: "Largest city" },
  { key: "motto", label: "Motto" },
] as const;

export const MEASURED_FACTS = [
  { key: "population", label: "Population", unit: "people" },
  { key: "area", label: "Area", unit: "km2" },
] as const;

/** A measured value while it is being typed: every field is still text. */
export interface MeasuredDraft {
  value: string;
  unit: string;
  observedAt: string;
}

export const EMPTY_MEASURED: MeasuredDraft = {
  value: "",
  unit: "",
  observedAt: "",
};

export interface RawOverrideRow {
  path: string;
  value: string;
}

/** Locale → the languages listed for it, as the form holds them. */
export type LanguageRows = Record<string, string>;

export interface EntityForm {
  type: EntityType;
  status: EntityStatus;
  inCatalog: boolean;
  parentKey: string;
  recognitionStatus: string;
  recognitionAsOf: string;
  validFrom: string;
  validTo: string;
  identifiers: Record<string, string>;
  nameOverrides: Record<string, string>;
  rawOverrides: RawOverrideRow[];
  localizedFacts: Record<string, Record<string, string>>;
  measuredFacts: Record<string, MeasuredDraft>;
  statehoodDate: string;
  languageRows: LanguageRows;
}

export function namePath(locale: string, field: string): string {
  return `names.${locale}.${field}`;
}

/** A JSON scalar typed into a text field: quoted → parsed, bare → string. */
export function parseOverrideValue(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function overrideText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function identifierError(key: string, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const rule = IDENTIFIERS.find((entry) => entry.key === key);
  if (rule === undefined) {
    return null;
  }
  if (rule.pattern !== undefined && !rule.pattern.test(trimmed)) {
    return `Expected ${rule.expected}`;
  }
  if (rule.maxLength !== undefined && trimmed.length > rule.maxLength) {
    return `Expected ${rule.expected}`;
  }
  return null;
}

function languagesToRows(
  languages: Record<string, string>[] | undefined,
): LanguageRows {
  const rows: LanguageRows = {};
  for (const entry of languages ?? []) {
    for (const [locale, value] of Object.entries(entry)) {
      rows[locale] =
        rows[locale] === undefined ? value : `${rows[locale]}, ${value}`;
    }
  }
  return rows;
}

/**
 * The inverse: one comma-separated list per locale becomes an ordered list
 * of languages, each carrying the locales that named it in that position.
 */
export function rowsToLanguages(rows: LanguageRows): Record<string, string>[] {
  const split: Record<string, string[]> = {};
  let longest = 0;
  for (const [locale, raw] of Object.entries(rows)) {
    const values = raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== "");
    if (values.length > 0) {
      split[locale] = values;
      longest = Math.max(longest, values.length);
    }
  }
  const languages: Record<string, string>[] = [];
  for (let index = 0; index < longest; index += 1) {
    const entry: Record<string, string> = {};
    for (const [locale, values] of Object.entries(split)) {
      const value = values[index];
      if (value !== undefined) {
        entry[locale] = value;
      }
    }
    if (Object.keys(entry).length > 0) {
      languages.push(entry);
    }
  }
  return languages;
}

function measuredToDraft(
  measured: { value: number; unit?: string; observedAt?: string } | undefined,
): MeasuredDraft {
  if (measured === undefined) {
    return EMPTY_MEASURED;
  }
  return {
    value: String(measured.value),
    unit: measured.unit ?? "",
    observedAt: measured.observedAt ?? "",
  };
}

/** The form as the stored entity would fill it in. */
export function formOf(entity: DraftEntityDetail["entity"]): EntityForm {
  const facts = entity.facts ?? {};
  const names: Record<string, string> = {};
  const raw: RawOverrideRow[] = [];
  for (const [path, value] of Object.entries(entity.overrides ?? {})) {
    const match = /^names\.([a-z-]+)\.(short|official)$/i.exec(path);
    if (match !== null && typeof value === "string") {
      names[path] = value;
    } else {
      raw.push({ path, value: overrideText(value) });
    }
  }
  return {
    type: entity.type,
    status: entity.status,
    inCatalog: entity.includeInCountryCatalog,
    parentKey: entity.parentKey ?? "",
    recognitionStatus: entity.recognitionStatus,
    recognitionAsOf: entity.recognitionAsOf ?? "",
    validFrom: entity.validFrom ?? "",
    validTo: entity.validTo ?? "",
    identifiers: { ...(entity.identifiers ?? {}) },
    nameOverrides: names,
    rawOverrides: raw,
    localizedFacts: {
      capital: { ...(facts.capital ?? {}) },
      largestCity: { ...(facts.largestCity ?? {}) },
      motto: { ...(facts.motto ?? {}) },
    },
    measuredFacts: {
      population: measuredToDraft(facts.population),
      area: measuredToDraft(facts.area),
    },
    statehoodDate: facts.statehoodDate ?? "",
    languageRows: languagesToRows(facts.languages),
  };
}

function assembleFacts(form: EntityForm): EntityFacts {
  const facts: EntityFacts = {};
  for (const { key } of LOCALIZED_FACTS) {
    const values: Record<string, string> = {};
    for (const [locale, value] of Object.entries(
      form.localizedFacts[key] ?? {},
    )) {
      if (value.trim() !== "") {
        values[locale] = value.trim();
      }
    }
    if (Object.keys(values).length > 0) {
      facts[key] = values;
    }
  }
  for (const { key } of MEASURED_FACTS) {
    const measured = form.measuredFacts[key] ?? EMPTY_MEASURED;
    if (measured.value.trim() === "") {
      continue;
    }
    const value = Number(measured.value);
    if (!Number.isFinite(value)) {
      continue;
    }
    facts[key] = {
      value,
      ...(measured.unit.trim() === "" ? {} : { unit: measured.unit.trim() }),
      ...(measured.observedAt.trim() === ""
        ? {}
        : { observedAt: measured.observedAt.trim() }),
    };
  }
  if (form.statehoodDate.trim() !== "") {
    facts.statehoodDate = form.statehoodDate.trim();
  }
  const languages = rowsToLanguages(form.languageRows);
  if (languages.length > 0) {
    facts.languages = languages;
  }
  return facts;
}

function assembleOverrides(form: EntityForm): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(form.nameOverrides)) {
    if (value.trim() !== "") {
      overrides[path] = value;
    }
  }
  for (const row of form.rawOverrides) {
    if (row.path.trim() !== "" && row.value.trim() !== "") {
      overrides[row.path.trim()] = parseOverrideValue(row.value);
    }
  }
  return overrides;
}

/** What the form would send. A subdivision's answers are pinned here. */
export function payloadOf(form: EntityForm): EntityUpdateBody {
  const identifiers: Record<string, string> = {};
  for (const [key, value] of Object.entries(form.identifiers)) {
    if (value.trim() !== "") {
      identifiers[key] = value.trim();
    }
  }
  const subdivision = form.type === "subdivision";
  return {
    type: form.type,
    status: form.status,
    includeInCountryCatalog: subdivision ? false : form.inCatalog,
    parentKey: subdivision ? form.parentKey.trim() : null,
    recognitionStatus: subdivision
      ? SUBDIVISION_RECOGNITION_STATUS
      : form.recognitionStatus,
    recognitionAsOf:
      form.recognitionAsOf.trim() === "" ? null : form.recognitionAsOf,
    validFrom: form.validFrom.trim() === "" ? null : form.validFrom,
    validTo: form.validTo.trim() === "" ? null : form.validTo,
    identifiers,
    facts: assembleFacts(form),
    overrides: assembleOverrides(form),
  };
}

/**
 * A comparison that does not depend on the order keys were typed in.
 *
 * `{a, b}` and `{b, a}` are the same entity, and a dirty flag that says
 * otherwise would ask an editor to confirm leaving a form they only looked
 * at.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  // `undefined` was filtered out above and a form holds no functions, so
  // this is always a string by the time it is reached.
  return JSON.stringify(value);
}

export function sameEntity(left: EntityForm, right: EntityForm): boolean {
  return canonical(payloadOf(left)) === canonical(payloadOf(right));
}

const CHANGE_LABEL: Record<string, string> = {
  type: "Kind",
  status: "Status",
  includeInCountryCatalog: "In country catalog",
  parentKey: "Parent",
  recognitionStatus: "Recognition status",
  recognitionAsOf: "Recognition as of",
  validFrom: "Valid from",
  validTo: "Valid to",
  identifiers: "Identifiers",
  facts: "Facts",
  overrides: "Names and overrides",
};

/**
 * What this editor changed, in words, for a conflict the editor has to carry
 * over by hand (§9). Field by field rather than a whole payload: after a
 * reload the fresh revision is the base, and only the differences go back on.
 */
export function entityChanges(
  baseline: EntityForm,
  current: EntityForm,
): UnsavedChange[] {
  const before = payloadOf(baseline) as Record<string, unknown>;
  const after = payloadOf(current) as Record<string, unknown>;
  const changes: UnsavedChange[] = [];
  for (const key of Object.keys(after)) {
    if (canonical(before[key]) === canonical(after[key])) {
      continue;
    }
    const value = after[key];
    changes.push({
      label: CHANGE_LABEL[key] ?? key,
      value:
        typeof value === "string" || typeof value === "boolean"
          ? String(value)
          : value === null
            ? "—"
            : JSON.stringify(value),
    });
  }
  return changes;
}
