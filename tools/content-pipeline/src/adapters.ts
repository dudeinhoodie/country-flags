import type {
  AssetCandidate,
  FieldPatch,
  NormalizedSource,
  Provenance,
  RelationCandidate,
  SourceAdapter,
  SourceDefinition,
  SourceKey,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

function empty(): NormalizedSource {
  return { patches: [], relations: [], assets: [] };
}

async function mapWithConcurrency<T, U>(
  values: T[],
  concurrency: number,
  map: (value: T) => Promise<U>,
): Promise<U[]> {
  const output = new Array<U>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        const value = values[index];
        if (value !== undefined) {
          output[index] = await map(value);
        }
      }
    }),
  );
  return output;
}

function provenance(source: SourceDefinition): Provenance {
  return {
    sourceKey: source.key,
    revision: source.revision,
    retrievedAt: source.retrievedAt,
  };
}

function patch(
  source: SourceDefinition,
  entity: FieldPatch["entity"],
  path: string,
  value: unknown,
  priority: number,
): FieldPatch {
  return { entity, path, value, priority, provenance: provenance(source) };
}

function records(snapshot: unknown, key: string): JsonRecord[] {
  const value = (snapshot as JsonRecord)[key];
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${key} array in ${key} adapter snapshot`);
  }
  return value as JsonRecord[];
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

function normalizeCldr(
  snapshot: unknown,
  source: SourceDefinition,
): NormalizedSource {
  const output = empty();
  const territories = (snapshot as JsonRecord).territories as Record<
    string,
    Record<string, string>
  >;
  for (const [isoAlpha2, names] of Object.entries(territories)) {
    for (const [locale, name] of Object.entries(names)) {
      output.patches.push(
        patch(source, { isoAlpha2 }, `names.${locale}.short`, name, 80),
      );
    }
  }
  const currencyUsage = (snapshot as JsonRecord).currencyUsage as Record<
    string,
    string[]
  >;
  const currencies = (snapshot as JsonRecord).currencies as Record<
    string,
    Record<string, string>
  >;
  for (const [isoAlpha2, codes] of Object.entries(currencyUsage)) {
    output.patches.push(
      patch(
        source,
        { isoAlpha2 },
        "facts.currencies",
        codes.map((code) => ({
          code,
          role: "legal_tender",
          names: currencies[code] ?? {},
        })),
        80,
      ),
    );
  }
  const containment = (snapshot as JsonRecord).containment;
  if (Array.isArray(containment)) {
    for (const record of containment as JsonRecord[]) {
      const isoAlpha2 = String(record.isoAlpha2);
      const regionKey = `region.${String(record.region)}`;
      const cldrSubregion = String(record.subregion);
      const subregion =
        (
          {
            australasia: "australia-and-new-zealand",
            "micronesian-region": "micronesia",
            "southeast-asia": "south-eastern-asia",
          } as Record<string, string>
        )[cldrSubregion] ?? cldrSubregion;
      const subregionKey = `subregion.${subregion}`;
      output.relations.push(
        {
          parentKey: subregionKey,
          child: { isoAlpha2 },
          taxonomyKey: "taxonomy.cldr",
          relationType: "contains",
          primary: false,
          provenance: provenance(source),
        },
        {
          parentKey: regionKey,
          child: { editorialKey: subregionKey },
          taxonomyKey: "taxonomy.cldr",
          relationType: "contains",
          primary: false,
          provenance: provenance(source),
        },
      );
    }
  }
  return output;
}

function normalizeUnM49(
  snapshot: unknown,
  source: SourceDefinition,
): NormalizedSource {
  const output = empty();
  for (const record of records(snapshot, "records")) {
    const isoAlpha2 = String(record.isoAlpha2);
    const region = String(record.region);
    const subregion = String(record.subregion);
    output.patches.push(
      patch(source, { isoAlpha2 }, "codes.isoAlpha3", record.isoAlpha3, 90),
      patch(source, { isoAlpha2 }, "codes.m49", record.m49, 90),
    );
    if (region.length > 0 && subregion.length > 0) {
      output.relations.push({
        parentKey: `subregion.${subregion}`,
        child: { isoAlpha2 },
        taxonomyKey: "taxonomy.un-m49",
        relationType: "contains",
        primary: true,
        provenance: provenance(source),
      });
      output.relations.push({
        parentKey: `region.${region}`,
        child: { editorialKey: `subregion.${subregion}` },
        taxonomyKey: "taxonomy.un-m49",
        relationType: "contains",
        primary: true,
        provenance: provenance(source),
      });
    }
  }
  return output;
}

function normalizeAnnexare(
  snapshot: unknown,
  source: SourceDefinition,
): NormalizedSource {
  const output = empty();
  for (const record of records(snapshot, "countries")) {
    const entity = { isoAlpha2: String(record.isoAlpha2) };
    output.patches.push(
      patch(
        source,
        entity,
        "facts.capitals",
        (record.capital as string[]).map((name) => ({
          name,
          role: "official",
        })),
        50,
      ),
      patch(
        source,
        entity,
        "facts.languages",
        (record.languages as string[]).map((code) => ({
          code,
          role: "official_or_common",
        })),
        50,
      ),
      patch(
        source,
        entity,
        "facts.currencies",
        (record.currencies as string[]).map((code) => ({
          code,
          role: "legal_tender",
        })),
        50,
      ),
    );
  }
  return output;
}

function normalizeWorldBank(
  snapshot: unknown,
  source: SourceDefinition,
): NormalizedSource {
  const output = empty();
  const year = Number((snapshot as JsonRecord).year);
  for (const record of records(snapshot, "records")) {
    output.patches.push(
      patch(
        source,
        { isoAlpha3: String(record.isoAlpha3) },
        "facts.population",
        { value: record.value, year },
        90,
      ),
    );
  }
  return output;
}

function normalizeWikidata(
  snapshot: unknown,
  source: SourceDefinition,
): NormalizedSource {
  const output = empty();
  for (const record of records(snapshot, "bindings")) {
    const editorialAlias = optionalString(
      record.editorialAlias,
      "editorialAlias",
    );
    const entity =
      editorialAlias === undefined
        ? { isoAlpha2: String(record.isoAlpha2) }
        : { editorialKey: editorialAlias };
    output.patches.push(
      patch(source, entity, "identifiers.wikidataId", record.wikidataId, 70),
      patch(source, entity, "crossChecks.capitals", record.capitals, 40),
      patch(source, entity, "crossChecks.languages", record.languages, 40),
    );
  }
  return output;
}

function normalizeFlagIcons(
  snapshot: unknown,
  source: SourceDefinition,
): NormalizedSource {
  const assets: AssetCandidate[] = records(snapshot, "assets").map((record) => {
    const editorialAlias = optionalString(
      record.editorialAlias,
      "editorialAlias",
    );
    const validFrom = optionalString(record.validFrom, "validFrom");
    const validTo = optionalString(record.validTo, "validTo");
    return {
      entity:
        editorialAlias === undefined
          ? { isoAlpha2: String(record.isoAlpha2) }
          : { editorialKey: editorialAlias },
      upstreamPath: String(record.path),
      svg: String(record.svg),
      aspectRatio: Number(record.aspectRatio),
      provenance: provenance(source),
      license: source.license,
      ...(validFrom === undefined ? {} : { validFrom }),
      ...(validTo === undefined ? {} : { validTo }),
    };
  });
  return { patches: [], relations: [], assets };
}

function adapter(normalize: SourceAdapter["normalize"]): SourceAdapter {
  return {
    async pull(source, fetchJson) {
      return fetchJson(source.url);
    },
    parse(payload) {
      return payload;
    },
    normalize,
  };
}

function cldrAdapter(): SourceAdapter {
  return {
    async pull(source, fetchJson) {
      const base = `https://raw.githubusercontent.com/unicode-org/cldr-json/${source.revision}/cldr-json`;
      const [
        enTerritories,
        ruTerritories,
        enCurrencies,
        ruCurrencies,
        territoryContainment,
        currencyData,
      ] = await Promise.all([
        fetchJson(`${base}/cldr-localenames-full/main/en/territories.json`),
        fetchJson(`${base}/cldr-localenames-full/main/ru/territories.json`),
        fetchJson(`${base}/cldr-numbers-full/main/en/currencies.json`),
        fetchJson(`${base}/cldr-numbers-full/main/ru/currencies.json`),
        fetchJson(`${base}/cldr-core/supplemental/territoryContainment.json`),
        fetchJson(`${base}/cldr-core/supplemental/currencyData.json`),
      ]);
      return {
        enTerritories,
        ruTerritories,
        enCurrencies,
        ruCurrencies,
        territoryContainment,
        currencyData,
      };
    },
    parse(payload, _source, currentSnapshot) {
      const raw = payload as Record<string, JsonRecord>;
      const current = currentSnapshot as {
        territories: Record<string, unknown>;
        currencies: Record<string, unknown>;
        currencyUsage: Record<string, string[]>;
      };
      const payloadFor = (key: string): JsonRecord => {
        const value = raw[key];
        if (value === undefined) {
          throw new Error(`CLDR response omitted ${key}`);
        }
        return value;
      };
      const territoryValues = (locale: "en" | "ru"): Record<string, string> =>
        (
          (
            (payloadFor(`${locale}Territories`).main as JsonRecord)[
              locale
            ] as JsonRecord
          ).localeDisplayNames as JsonRecord
        ).territories as Record<string, string>;
      const currencyValues = (
        locale: "en" | "ru",
      ): Record<string, JsonRecord> =>
        (
          (
            (payloadFor(`${locale}Currencies`).main as JsonRecord)[
              locale
            ] as JsonRecord
          ).numbers as JsonRecord
        ).currencies as Record<string, JsonRecord>;
      const territories = Object.fromEntries(
        Object.keys(current.territories)
          .sort()
          .map((code) => [
            code,
            {
              en: territoryValues("en")[code],
              ru: territoryValues("ru")[code],
            },
          ]),
      );
      const currencyRegions = (
        (payloadFor("currencyData").supplemental as JsonRecord)
          .currencyData as JsonRecord
      ).region as Record<string, JsonRecord | JsonRecord[]>;
      const currencyUsage = Object.fromEntries(
        Object.keys(current.territories)
          .sort()
          .flatMap((code) => {
            const rawUsage = currencyRegions[code];
            const entries = Array.isArray(rawUsage)
              ? rawUsage
              : rawUsage === undefined
                ? []
                : [rawUsage];
            const codes = [
              ...new Set(
                entries
                  .flatMap((entry) => Object.entries(entry))
                  .filter(
                    ([, metadata]) =>
                      typeof metadata === "object" &&
                      metadata !== null &&
                      (metadata as JsonRecord)._to === undefined &&
                      (metadata as JsonRecord)._tender !== "false",
                  )
                  .map(([currencyCode]) => currencyCode),
              ),
            ].sort();
            return codes.length === 0 ? [] : [[code, codes]];
          }),
      );
      const selectedCurrencies = [
        ...new Set(Object.values(currencyUsage).flat()),
      ].sort();
      const currencies = Object.fromEntries(
        selectedCurrencies.map((code) => {
          const en = currencyValues("en")[code]?.displayName;
          const ru = currencyValues("ru")[code]?.displayName;
          return [
            code,
            {
              ...(typeof en === "string" ? { en } : {}),
              ...(typeof ru === "string" ? { ru } : {}),
            },
          ];
        }),
      );
      const containmentRoot = (
        payloadFor("territoryContainment").supplemental as JsonRecord
      ).territoryContainment as Record<string, JsonRecord>;
      const findPath = (
        parent: string,
        target: string,
        visited = new Set<string>(),
      ): string[] | undefined => {
        if (visited.has(parent)) {
          return undefined;
        }
        visited.add(parent);
        const children = containmentRoot[parent]?._contains;
        if (!Array.isArray(children)) {
          return undefined;
        }
        if (children.includes(target)) {
          return [parent, target];
        }
        for (const child of children) {
          if (typeof child !== "string") {
            continue;
          }
          const path = findPath(child, target, new Set(visited));
          if (path !== undefined) {
            return [parent, ...path];
          }
        }
        return undefined;
      };
      const containment = Object.keys(current.territories)
        .sort()
        .flatMap((isoAlpha2) => {
          const path = findPath("001", isoAlpha2);
          if (path === undefined || path.length < 3) {
            return [];
          }
          const regionCode = path[1];
          const subregionCode = path.at(-2);
          if (regionCode === undefined || subregionCode === undefined) {
            return [];
          }
          return [
            {
              isoAlpha2,
              region: slug(territoryValues("en")[regionCode] ?? regionCode),
              subregion: slug(
                territoryValues("en")[subregionCode] ?? subregionCode,
              ),
            },
          ];
        });
      return {
        territories,
        currencies,
        currencyUsage,
        containment,
      };
    },
    normalize: normalizeCldr,
  };
}

function parseWorldBankPayload(
  payload: unknown,
  _source: SourceDefinition,
  currentSnapshot: unknown,
): unknown {
  if (!Array.isArray(payload)) {
    return payload;
  }
  const rows: unknown = (payload as unknown[])[1];
  if (!Array.isArray(rows)) {
    throw new Error("World Bank response does not contain indicator rows");
  }
  const selectedCodes = new Set(
    ((currentSnapshot as JsonRecord).selectedIsoAlpha3 as unknown[]).map(
      String,
    ),
  );
  const normalizedRows = (rows as JsonRecord[])
    .filter(
      ({ countryiso3code, value }) =>
        selectedCodes.has(String(countryiso3code)) && typeof value === "number",
    )
    .map(({ countryiso3code, value }) => ({
      isoAlpha3: String(countryiso3code),
      value,
    }))
    .sort((left, right) => left.isoAlpha3.localeCompare(right.isoAlpha3, "en"));
  const year = Number((rows[0] as JsonRecord | undefined)?.date);
  return {
    indicator: "SP.POP.TOTL",
    year,
    selectedIsoAlpha3: [...selectedCodes].sort(),
    records: normalizedRows,
  };
}

function annexareAdapter(): SourceAdapter {
  return {
    pull(source, fetchJson) {
      return fetchJson(
        `https://raw.githubusercontent.com/annexare/Countries/${source.revision}/dist/countries.min.json`,
      );
    },
    parse(payload, _source, currentSnapshot) {
      const upstream = payload as Record<string, JsonRecord>;
      const selected = (
        (currentSnapshot as JsonRecord).selectedIsoAlpha2 as unknown[]
      ).map(String);
      return {
        selectedIsoAlpha2: selected,
        countries: selected.flatMap((code) => {
          const country = upstream[code];
          if (country === undefined) {
            return [];
          }
          const capital =
            typeof country.capital === "string" &&
            country.capital.trim().length > 0
              ? [country.capital]
              : [];
          return {
            isoAlpha2: code,
            capital,
            languages: country.languages,
            currencies: country.currency,
          };
        }),
      };
    },
    normalize: normalizeAnnexare,
  };
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/gu, "")
    .replace(/&amp;/gu, "&")
    .replace(/&nbsp;|&#160;/gu, " ")
    .replace(/&#(\d+);/gu, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .trim();
}

function unM49Adapter(): SourceAdapter {
  return {
    pull(source, fetchPayload) {
      return fetchPayload(source.url);
    },
    parse(payload, _source, currentSnapshot) {
      if (typeof payload !== "string") {
        return payload;
      }
      const existingByCode = new Map(
        records(currentSnapshot, "records").map((record) => [
          String(record.isoAlpha2),
          record,
        ]),
      );
      const parsed = new Map<string, JsonRecord>();
      for (const rowMatch of payload.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/giu)) {
        const cells = [
          ...String(rowMatch[1]).matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/giu),
        ].map((match) => decodeHtml(String(match[1])));
        const isoAlpha2 = cells[10];
        const isoAlpha3 = cells[11];
        const m49 = cells[9];
        const countryOrArea = cells[8];
        const region = cells[3];
        const regionCode = cells[2];
        const subregionName = cells[7]?.trim().length ? cells[7] : cells[5];
        const subregionCode = cells[7]?.trim().length ? cells[6] : cells[4];
        if (
          isoAlpha2 !== undefined &&
          isoAlpha3 !== undefined &&
          m49 !== undefined &&
          countryOrArea !== undefined &&
          region !== undefined &&
          regionCode !== undefined &&
          subregionName !== undefined &&
          subregionCode !== undefined &&
          /^[A-Z]{2}$/u.test(isoAlpha2) &&
          /^[A-Z]{3}$/u.test(isoAlpha3) &&
          /^[0-9]{3}$/u.test(m49) &&
          !parsed.has(isoAlpha2)
        ) {
          const existing = existingByCode.get(isoAlpha2);
          parsed.set(isoAlpha2, {
            isoAlpha2,
            isoAlpha3,
            m49,
            countryOrArea,
            region: slug(region),
            regionCode,
            regionName: region,
            subregion: slug(subregionName),
            subregionCode,
            subregionName,
            ...(typeof existing?.entityKey === "string"
              ? { entityKey: existing.entityKey }
              : {}),
          });
        }
      }
      if (parsed.size < 240) {
        throw new Error(
          `UN M49 response contains only ${String(parsed.size)} country/area records (response bytes: ${String(Buffer.byteLength(payload))})`,
        );
      }
      return {
        records: [...parsed.values()].sort((left, right) =>
          String(left.isoAlpha2).localeCompare(String(right.isoAlpha2), "en"),
        ),
      };
    },
    normalize: normalizeUnM49,
  };
}

function flagIconsAdapter(): SourceAdapter {
  return {
    async pull(source, fetchJson, currentSnapshot) {
      const assets = records(currentSnapshot, "assets");
      return mapWithConcurrency(assets, 8, async (asset) => ({
        current: asset,
        upstream: await fetchJson(
          `https://raw.githubusercontent.com/lipis/flag-icons/${source.revision}/${String(asset.path)}`,
        ),
      }));
    },
    parse(payload) {
      if (!Array.isArray(payload)) {
        throw new Error("flag-icons response must contain selected assets");
      }
      return {
        assets: payload.map((entry) => {
          const { current, upstream } = entry as {
            current: JsonRecord;
            upstream: JsonRecord;
          };
          if (typeof upstream !== "string") {
            throw new Error("flag-icons asset response is not SVG text");
          }
          return {
            ...current,
            svg: upstream,
          };
        }),
      };
    },
    normalize: normalizeFlagIcons,
  };
}

function wikidataAdapter(): SourceAdapter {
  return {
    async pull(source, fetchJson, currentSnapshot) {
      const selected = (
        (currentSnapshot as JsonRecord).selectedIsoAlpha2 as unknown[]
      ).map(String);
      const chunks = Array.from(
        { length: Math.ceil(selected.length / 40) },
        (_, index) => selected.slice(index * 40, index * 40 + 40),
      );
      const responses = await mapWithConcurrency(chunks, 2, async (chunk) => {
        const values = chunk.map((code) => `"${code}"`).join(" ");
        const query = `
          SELECT ?country ?isoAlpha2 ?capital ?language ?sitelinks WHERE {
            VALUES ?isoAlpha2 { ${values} }
            ?country wdt:P297 ?isoAlpha2.
            ?country wikibase:sitelinks ?sitelinks.
            FILTER NOT EXISTS { ?country wdt:P576 ?dissolved. }
            OPTIONAL { ?country wdt:P36 ?capital. }
            OPTIONAL { ?country wdt:P37 ?language. }
          }
        `;
        return fetchJson(
          `${source.url}?query=${encodeURIComponent(query)}&format=json`,
        );
      });
      return {
        results: {
          bindings: responses.flatMap(
            (response) =>
              ((response as JsonRecord).results as JsonRecord)
                .bindings as JsonRecord[],
          ),
        },
      };
    },
    parse(payload, _source, currentSnapshot) {
      const responseBindings = ((payload as JsonRecord).results as JsonRecord)
        .bindings as JsonRecord[];
      const grouped = new Map<
        string,
        {
          capitals: Set<string>;
          languages: Set<string>;
          isoAlpha2?: string;
          sitelinks: number;
        }
      >();
      for (const row of responseBindings) {
        const wikidataId = String(
          ((row.country as JsonRecord).value as string).split("/").at(-1),
        );
        const value = grouped.get(wikidataId) ?? {
          capitals: new Set<string>(),
          languages: new Set<string>(),
          sitelinks: 0,
        };
        const isoAlpha2 = (row.isoAlpha2 as JsonRecord | undefined)?.value;
        if (typeof isoAlpha2 === "string") {
          value.isoAlpha2 = isoAlpha2;
        }
        const sitelinks = Number(
          (row.sitelinks as JsonRecord | undefined)?.value,
        );
        if (Number.isFinite(sitelinks)) {
          value.sitelinks = sitelinks;
        }
        for (const [field, target] of [
          ["capital", value.capitals],
          ["language", value.languages],
        ] as const) {
          const uri = (row[field] as JsonRecord | undefined)?.value;
          const id =
            typeof uri === "string" ? uri.split("/").at(-1) : undefined;
          if (id !== undefined) {
            target.add(id);
          }
        }
        grouped.set(wikidataId, value);
      }
      const bindings: JsonRecord[] = [];
      const selectedCodes = new Set<string>();
      for (const [wikidataId, value] of [...grouped.entries()]
        .filter(([, candidate]) => candidate.isoAlpha2 !== undefined)
        .sort(
          ([leftId, left], [rightId, right]) =>
            String(left.isoAlpha2).localeCompare(
              String(right.isoAlpha2),
              "en",
            ) ||
            right.sitelinks - left.sitelinks ||
            leftId.localeCompare(rightId, "en"),
        )) {
        const isoAlpha2 = String(value.isoAlpha2);
        if (selectedCodes.has(isoAlpha2)) {
          continue;
        }
        selectedCodes.add(isoAlpha2);
        bindings.push({
          wikidataId,
          isoAlpha2,
          capitals: [...value.capitals].sort(),
          languages: [...value.languages].sort(),
        });
      }
      return {
        selectedIsoAlpha2: (
          (currentSnapshot as JsonRecord).selectedIsoAlpha2 as unknown[]
        ).map(String),
        bindings,
      };
    },
    normalize: normalizeWikidata,
  };
}

const adapters: Record<SourceKey, SourceAdapter> = {
  cldr: cldrAdapter(),
  "un-m49": unM49Adapter(),
  annexare: annexareAdapter(),
  "world-bank": {
    ...adapter(normalizeWorldBank),
    parse: parseWorldBankPayload,
  },
  wikidata: wikidataAdapter(),
  "flag-icons": flagIconsAdapter(),
  editorial: adapter(() => empty()),
};

export function sourceAdapter(source: SourceDefinition): SourceAdapter {
  return adapters[source.adapter];
}

export function normalizeSource(
  snapshot: unknown,
  source: SourceDefinition,
): NormalizedSource {
  return sourceAdapter(source).normalize(snapshot, source);
}

export type { RelationCandidate };
