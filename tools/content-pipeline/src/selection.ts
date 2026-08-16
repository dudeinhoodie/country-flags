import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { format } from "prettier";

import { loadRegistry, loadVerifiedSnapshot } from "./registry.js";
import { readJson, sha256, stableJson, writeJson } from "./stable-json.js";
import type {
  EditorialCatalog,
  EditorialEntity,
  SourceDefinition,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

const UN_MEMBER_CODES = new Set(
  "AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW".split(
    " ",
  ),
);
const OBSERVER_CODES = new Set(["PS", "VA"]);
const PARTIALLY_RECOGNIZED_CODES = new Set(["EH", "TW"]);
const SPECIAL_AREA_CODES = new Set(["AQ", "BV", "CK", "HM", "NU", "TF", "UM"]);
const DEPENDENT_TERRITORY_CODES = new Set(
  "AS AI AW AX BL BM BQ CC CW CX FK FO GF GG GI GL GP GS GU HK IM IO JE KY MF MO MP MQ MS NC NF PF PM PN PR RE SH SJ SX TC TK VG VI WF YT".split(
    " ",
  ),
);

const REGION_RU: Record<string, string> = {
  africa: "Африка",
  americas: "Америка",
  asia: "Азия",
  europe: "Европа",
  oceania: "Океания",
};

const SUBREGION_RU: Record<string, string> = {
  "australia-and-new-zealand": "Австралия и Новая Зеландия",
  caribbean: "Карибский бассейн",
  "central-america": "Центральная Америка",
  "central-asia": "Центральная Азия",
  "eastern-africa": "Восточная Африка",
  "eastern-asia": "Восточная Азия",
  "eastern-europe": "Восточная Европа",
  melanesia: "Меланезия",
  micronesia: "Микронезия",
  "middle-africa": "Центральная Африка",
  "northern-africa": "Северная Африка",
  "northern-america": "Северная Америка",
  "northern-europe": "Северная Европа",
  polynesia: "Полинезия",
  "south-america": "Южная Америка",
  "south-eastern-asia": "Юго-Восточная Азия",
  "southern-africa": "Южная Африка",
  "southern-asia": "Южная Азия",
  "southern-europe": "Южная Европа",
  "western-africa": "Западная Африка",
  "western-asia": "Западная Азия",
  "western-europe": "Западная Европа",
  "outlying-oceania": "Внешняя Океания",
};

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function policyFor(
  code: string,
): Pick<EditorialEntity, "type" | "recognitionStatus"> {
  if (UN_MEMBER_CODES.has(code)) {
    return { type: "country", recognitionStatus: "un_member" };
  }
  if (OBSERVER_CODES.has(code)) {
    return { type: "country", recognitionStatus: "un_observer" };
  }
  if (PARTIALLY_RECOGNIZED_CODES.has(code)) {
    return { type: "country", recognitionStatus: "partially_recognized" };
  }
  if (SPECIAL_AREA_CODES.has(code)) {
    return { type: "area", recognitionStatus: "special_area" };
  }
  if (DEPENDENT_TERRITORY_CODES.has(code)) {
    return { type: "territory", recognitionStatus: "dependent_territory" };
  }
  throw new Error(
    `UN M49 code ${code} has no reviewed editorial classification`,
  );
}

function entityKey(
  type: EditorialEntity["type"],
  name: string,
  used: Set<string>,
): string {
  const prefix = type === "area" ? "area" : type;
  const base = `${prefix}.${slug(name)}`;
  let key = base;
  let suffix = 2;
  while (used.has(key)) {
    key = `${base}-${String(suffix)}`;
    suffix += 1;
  }
  used.add(key);
  return key;
}

async function updateSnapshot(
  root: string,
  source: SourceDefinition,
  document: unknown,
): Promise<void> {
  const content = stableJson(document);
  await writeJson(join(root, source.snapshotPath), document);
  source.sha256 = sha256(content);
}

async function updateEditorial(
  root: string,
  source: SourceDefinition,
  document: EditorialCatalog,
): Promise<void> {
  const content = await format(stableJson(document), { parser: "json" });
  await writeFile(join(root, source.snapshotPath), content, "utf8");
  source.sha256 = sha256(content);
}

export async function syncSelection(root: string): Promise<void> {
  const registry = await loadRegistry(root);
  const source = (key: SourceDefinition["key"]): SourceDefinition => {
    const result = registry.sources.find((candidate) => candidate.key === key);
    if (result === undefined) {
      throw new Error(`Missing required source ${key}`);
    }
    return result;
  };
  const editorialSource = source("editorial");
  const unSource = source("un-m49");
  const editorial = await loadVerifiedSnapshot<EditorialCatalog>(
    root,
    editorialSource,
  );
  const unSnapshot = await loadVerifiedSnapshot<{ records: JsonRecord[] }>(
    root,
    unSource,
  );
  const existingByIso = new Map(
    editorial.entities.flatMap((entity) =>
      entity.identifiers?.isoAlpha2 === undefined
        ? []
        : [[entity.identifiers.isoAlpha2, entity] as const],
    ),
  );
  const preserved = editorial.entities.filter(
    (entity) =>
      entity.type === "region" ||
      entity.type === "subregion" ||
      entity.identifiers?.customCode !== undefined,
  );
  const usedKeys = new Set(preserved.map(({ key }) => key));
  const selectedEntities = unSnapshot.records.map((record) => {
    const isoAlpha2 = String(record.isoAlpha2);
    const countryOrArea = String(record.countryOrArea);
    const policy = policyFor(isoAlpha2);
    const existing = existingByIso.get(isoAlpha2);
    const key =
      existing?.key ?? entityKey(policy.type, countryOrArea, usedKeys);
    usedKeys.add(key);
    record.entityKey = key;
    return {
      ...(existing ?? {}),
      key,
      type: policy.type,
      status: "active" as const,
      includeInCountryCatalog: true,
      recognitionStatus: policy.recognitionStatus,
      ...(policy.recognitionStatus === "partially_recognized"
        ? { recognitionAsOf: "2026-07-28" }
        : {}),
      identifiers: { isoAlpha2 },
    };
  });
  const taiwanExisting = existingByIso.get("TW");
  const taiwan: EditorialEntity = {
    ...(taiwanExisting ?? {}),
    key: taiwanExisting?.key ?? "country.taiwan",
    type: "country",
    status: "active",
    includeInCountryCatalog: true,
    recognitionStatus: "partially_recognized",
    recognitionAsOf: "2026-07-28",
    identifiers: { isoAlpha2: "TW", isoAlpha3: "TWN" },
  };
  const regionEntities = new Map<string, EditorialEntity>();
  const subregionEntities = new Map<string, EditorialEntity>();
  for (const record of unSnapshot.records) {
    const region = String(record.region);
    const regionName = String(record.regionName);
    const subregion = String(record.subregion);
    const subregionName = String(record.subregionName);
    if (
      region.length === 0 ||
      regionName.length === 0 ||
      subregion.length === 0 ||
      subregionName.length === 0
    ) {
      continue;
    }
    regionEntities.set(`region.${region}`, {
      key: `region.${region}`,
      type: "region",
      status: "active",
      includeInCountryCatalog: false,
      recognitionStatus: "not_applicable",
      overrides: {
        "names.en.short": regionName,
        "names.ru.short": REGION_RU[region] ?? regionName,
      },
    });
    subregionEntities.set(`subregion.${subregion}`, {
      key: `subregion.${subregion}`,
      type: "subregion",
      status: "active",
      includeInCountryCatalog: false,
      recognitionStatus: "not_applicable",
      overrides: {
        "names.en.short": subregionName,
        "names.ru.short": SUBREGION_RU[subregion] ?? subregionName,
      },
    });
  }
  subregionEntities.set("subregion.outlying-oceania", {
    key: "subregion.outlying-oceania",
    type: "subregion",
    status: "active",
    includeInCountryCatalog: false,
    recognitionStatus: "not_applicable",
    overrides: {
      "names.en.short": "Outlying Oceania",
      "names.ru.short": SUBREGION_RU["outlying-oceania"],
    },
  });
  /**
 * Territories whose plain ISO file carries the parent state's flag while the
 * territory has a flag of its own, published by flag-icons as a subdivision
 * file. `SH` is the composite "Saint Helena, Ascension and Tristan da Cunha"
 * and its file is the Union Flag; the catalog's entity is Saint Helena
 * itself, whose flag is the blue ensign in `sh-hl`.
 */
const FLAG_FILE_OVERRIDES: Record<string, string> = {
  SH: "sh-hl",
};

const extras = preserved.filter(
    (entity) =>
      entity.type !== "region" &&
      entity.type !== "subregion" &&
      entity.key !== taiwan.key,
  );
  editorial.entities = [
    ...selectedEntities,
    taiwan,
    ...extras,
    ...regionEntities.values(),
    ...subregionEntities.values(),
  ].sort((left, right) => left.key.localeCompare(right.key, "en"));
  editorial.sourceAliases = {
    ...editorial.sourceAliases,
    "annexare:XK": "country.kosovo",
    "cldr:XK": "country.kosovo",
    "flag-icons:XK": "country.kosovo",
    "wikidata:XK": "country.kosovo",
  };

  const selectedIsoAlpha2 = editorial.entities
    .flatMap((entity) => {
      const code =
        entity.identifiers?.isoAlpha2 ??
        (entity.identifiers?.customCode === "XK" ? "XK" : undefined);
      return entity.includeInCountryCatalog && code !== undefined ? [code] : [];
    })
    .sort();
  const isoAlpha3ByAlpha2 = new Map(
    unSnapshot.records.map((record) => [
      String(record.isoAlpha2),
      String(record.isoAlpha3),
    ]),
  );
  isoAlpha3ByAlpha2.set("TW", "TWN");

  await updateSnapshot(root, unSource, unSnapshot);
  await updateEditorial(root, editorialSource, editorial);

  const cldrSource = source("cldr");
  const cldr = await readJson<JsonRecord>(join(root, cldrSource.snapshotPath));
  const currentTerritories = cldr.territories as Record<string, unknown>;
  await updateSnapshot(root, cldrSource, {
    territories: Object.fromEntries(
      selectedIsoAlpha2.map((code) => [
        code,
        currentTerritories[code] ?? { en: code, ru: code },
      ]),
    ),
    currencies: cldr.currencies,
    currencyUsage: cldr.currencyUsage,
    containment: cldr.containment,
  });

  const annexareSource = source("annexare");
  const annexare = await readJson<{ countries: JsonRecord[] }>(
    join(root, annexareSource.snapshotPath),
  );
  await updateSnapshot(root, annexareSource, {
    selectedIsoAlpha2,
    countries: annexare.countries.filter((record) =>
      selectedIsoAlpha2.includes(String(record.isoAlpha2)),
    ),
  });

  const worldBankSource = source("world-bank");
  const worldBank = await readJson<JsonRecord>(
    join(root, worldBankSource.snapshotPath),
  );
  const selectedIsoAlpha3 = selectedIsoAlpha2
    .flatMap((code) => {
      const alpha3 = isoAlpha3ByAlpha2.get(code);
      return alpha3 === undefined ? [] : [alpha3];
    })
    .sort();
  await updateSnapshot(root, worldBankSource, {
    indicator: worldBank.indicator,
    year: worldBank.year,
    selectedIsoAlpha3,
    records: (worldBank.records as JsonRecord[]).filter((record) =>
      selectedIsoAlpha3.includes(String(record.isoAlpha3)),
    ),
  });

  const wikidataSource = source("wikidata");
  const wikidata = await readJson<{ bindings: JsonRecord[] }>(
    join(root, wikidataSource.snapshotPath),
  );
  await updateSnapshot(root, wikidataSource, {
    selectedIsoAlpha2,
    bindings: wikidata.bindings,
  });

  const flagSource = source("flag-icons");
  const flagSnapshot = await readJson<{ assets: JsonRecord[] }>(
    join(root, flagSource.snapshotPath),
  );
  const assetsByCode = new Map(
    flagSnapshot.assets.map((asset) => {
      const code =
        typeof asset.isoAlpha2 === "string"
          ? asset.isoAlpha2
          : asset.editorialAlias === "country.kosovo"
            ? "XK"
            : "";
      return [code, asset];
    }),
  );
  await updateSnapshot(root, flagSource, {
    assets: selectedIsoAlpha2.map((code) => {
      const existing = assetsByCode.get(code);
      return {
        ...(existing ?? {}),
        ...(code === "XK"
          ? { editorialAlias: "country.kosovo" }
          : { isoAlpha2: code }),
        path: `flags/4x3/${FLAG_FILE_OVERRIDES[code] ?? code.toLowerCase()}.svg`,
        aspectRatio: 1.333333,
        svg: typeof existing?.svg === "string" ? existing.svg : "",
      };
    }),
  });

  await writeJson(join(root, "sources/registry.json"), registry);
}
