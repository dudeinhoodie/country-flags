import { createHash } from "node:crypto";

import {
  AssetStatus,
  AssetType,
  CardStatus,
  ContentReleaseStatus,
  DeckKind,
  DeckStatus,
  GeoEntityKind,
  GeoEntityStatus,
  GeoNameType,
  GeoRelationType,
  GradingMode,
  ProgressPolicy,
  PublicationStatus,
  RecognitionStatus,
  RevisionChangeClassification,
} from "@prisma/client";

const CONTENT_VERSION = "test-only-fixture-v1";
const CREATED_AT = "2026-07-28T12:00:00.000Z";
const ASSET_SOURCE_ID = "10000000-0000-4000-8000-000000000001";
const NAMES_SOURCE_ID = "10000000-0000-4000-8000-000000000002";
const TEMPLATE_ID = "20000000-0000-4000-8000-000000000001";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface FixtureCountry {
  id: string;
  key: string;
  slug: string;
  alpha2?: string;
  alpha3?: string;
  m49?: string;
  customCode?: string;
  recognitionStatus: RecognitionStatus;
  en: string;
  ru: string;
  aspectRatio: number;
  sortOrder: number;
  inEurope: boolean;
}

interface FixtureLearningCard {
  id: string;
  subjectEntityId: string;
  templateId: string;
  semanticVersion: number;
  supersedesLearningCardId: string | null;
  status: CardStatus;
  contentVersion: string;
}

const countries: FixtureCountry[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    key: "country.belgium",
    slug: "belgium",
    alpha2: "BE",
    alpha3: "BEL",
    m49: "056",
    recognitionStatus: RecognitionStatus.UN_MEMBER,
    en: "Belgium",
    ru: "Бельгия",
    aspectRatio: 1.5,
    sortOrder: 10,
    inEurope: true,
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    key: "country.france",
    slug: "france",
    alpha2: "FR",
    alpha3: "FRA",
    m49: "250",
    recognitionStatus: RecognitionStatus.UN_MEMBER,
    en: "France",
    ru: "Франция",
    aspectRatio: 1.5,
    sortOrder: 20,
    inEurope: true,
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    key: "country.germany",
    slug: "germany",
    alpha2: "DE",
    alpha3: "DEU",
    m49: "276",
    recognitionStatus: RecognitionStatus.UN_MEMBER,
    en: "Germany",
    ru: "Германия",
    aspectRatio: 1.666667,
    sortOrder: 30,
    inEurope: true,
  },
  {
    id: "30000000-0000-4000-8000-000000000004",
    key: "country.kazakhstan",
    slug: "kazakhstan",
    alpha2: "KZ",
    alpha3: "KAZ",
    m49: "398",
    recognitionStatus: RecognitionStatus.UN_MEMBER,
    en: "Kazakhstan",
    ru: "Казахстан",
    aspectRatio: 2,
    sortOrder: 40,
    inEurope: true,
  },
  {
    id: "30000000-0000-4000-8000-000000000005",
    key: "country.kosovo",
    slug: "kosovo",
    customCode: "KOSOVO",
    recognitionStatus: RecognitionStatus.PARTIALLY_RECOGNIZED,
    en: "Kosovo",
    ru: "Косово",
    aspectRatio: 1.4,
    sortOrder: 50,
    inEurope: true,
  },
  {
    id: "30000000-0000-4000-8000-000000000006",
    key: "country.nepal",
    slug: "nepal",
    alpha2: "NP",
    alpha3: "NPL",
    m49: "524",
    recognitionStatus: RecognitionStatus.UN_MEMBER,
    en: "Nepal",
    ru: "Непал",
    aspectRatio: 1.21901,
    sortOrder: 60,
    inEurope: false,
  },
  {
    id: "30000000-0000-4000-8000-000000000007",
    key: "country.russia",
    slug: "russia",
    alpha2: "RU",
    alpha3: "RUS",
    m49: "643",
    recognitionStatus: RecognitionStatus.UN_MEMBER,
    en: "Russia",
    ru: "Россия",
    aspectRatio: 1.5,
    sortOrder: 70,
    inEurope: true,
  },
  {
    id: "30000000-0000-4000-8000-000000000008",
    key: "country.switzerland",
    slug: "switzerland",
    alpha2: "CH",
    alpha3: "CHE",
    m49: "756",
    recognitionStatus: RecognitionStatus.UN_MEMBER,
    en: "Switzerland",
    ru: "Швейцария",
    aspectRatio: 1,
    sortOrder: 80,
    inEurope: true,
  },
];

const regions = [
  {
    id: "30000000-0000-4000-8000-000000000101",
    key: "region.europe",
    slug: "europe",
    en: "Europe",
    ru: "Европа",
  },
  {
    id: "30000000-0000-4000-8000-000000000102",
    key: "region.asia",
    slug: "asia",
    en: "Asia",
    ru: "Азия",
  },
];

function cardId(country: FixtureCountry, semanticVersion = 1): string {
  const suffix = country.id.slice(-12);
  return `${semanticVersion === 1 ? "50000000" : "50000001"}-0000-4000-8000-${suffix}`;
}

function assetId(country: FixtureCountry, revision = 1): string {
  const suffix = country.id.slice(-12);
  return `${revision === 1 ? "40000000" : "40000001"}-0000-4000-8000-${suffix}`;
}

const manifest = {
  $schema:
    "https://country-flags.app/contracts/content/v1/manifest.schema.json",
  schemaVersion: 1,
  contentVersion: CONTENT_VERSION,
  createdAt: CREATED_AT,
  defaultLocale: "ru",
  supportedLocales: ["ru", "en"],
  minimumClientVersion: "1.0.0",
  supportedTemplateSchemaVersions: [1],
  assetBaseUrl: `https://fixtures.country-flags.test/${CONTENT_VERSION}/`,
  changeCursor: Buffer.from(
    JSON.stringify({ version: CONTENT_VERSION, sequence: 0 }),
  ).toString("base64url"),
  files: [
    {
      path: "test-content.fixture.json",
      bytes: 1,
      sha256: sha256("country-flags-test-content-fixture-v1"),
      schemaId:
        "https://country-flags.app/content/v1/test-content-fixture.schema.json",
    },
  ],
  signature: {
    algorithm: "Ed25519",
    keyId: "TEST_ONLY",
    value: Buffer.from("TEST_ONLY_SIGNATURE").toString("base64"),
  },
};

const assets = countries.flatMap((country) => {
  const current = {
    id: assetId(country),
    geoEntityId: country.id,
    assetType: AssetType.FLAG,
    variant: "current",
    objectKey: `${CONTENT_VERSION}/flags/${country.slug}.svg`,
    publicUrl: `${manifest.assetBaseUrl}flags/${country.slug}.svg`,
    mimeType: "image/svg+xml",
    sha256: sha256(`fixture-flag:${country.key}:1`),
    width: Math.round(country.aspectRatio * 1_000),
    height: 1_000,
    aspectRatio: country.aspectRatio,
    sourceId: ASSET_SOURCE_ID,
    licenseName: "MIT",
    licenseUrl: "https://opensource.org/license/mit",
    attribution: "TEST_ONLY flag fixture",
    status: AssetStatus.PUBLISHED,
    contentVersion: CONTENT_VERSION,
  };

  const hasReplacementAsset = [
    "country.russia",
    "country.switzerland",
  ].includes(country.key);
  if (!hasReplacementAsset) {
    return [current];
  }

  const replacementVariant =
    country.key === "country.switzerland" ? "optimized" : "material-v2";
  return [
    current,
    {
      ...current,
      id: assetId(country, 2),
      variant: replacementVariant,
      objectKey: `${CONTENT_VERSION}/flags/${country.slug}.${replacementVariant}.svg`,
      publicUrl: `${manifest.assetBaseUrl}flags/${country.slug}.${replacementVariant}.svg`,
      sha256: sha256(`fixture-flag:${country.key}:2`),
    },
  ];
});

const learningCards = countries.flatMap<FixtureLearningCard>((country) => {
  if (country.key !== "country.russia") {
    return [
      {
        id: cardId(country),
        subjectEntityId: country.id,
        templateId: TEMPLATE_ID,
        semanticVersion: 1,
        supersedesLearningCardId: null,
        status: CardStatus.ACTIVE,
        contentVersion: CONTENT_VERSION,
      },
    ];
  }

  const previousId = cardId(country);
  return [
    {
      id: previousId,
      subjectEntityId: country.id,
      templateId: TEMPLATE_ID,
      semanticVersion: 1,
      supersedesLearningCardId: null,
      status: CardStatus.RETIRED,
      contentVersion: CONTENT_VERSION,
    },
    {
      id: cardId(country, 2),
      subjectEntityId: country.id,
      templateId: TEMPLATE_ID,
      semanticVersion: 2,
      supersedesLearningCardId: previousId,
      status: CardStatus.ACTIVE,
      contentVersion: CONTENT_VERSION,
    },
  ];
});

const revisions = learningCards.flatMap((card) => {
  const country = countries.find(({ id }) => id === card.subjectEntityId);
  if (country === undefined) {
    throw new Error("Fixture card has no subject");
  }

  const firstRevision = {
    id: `60000000-${card.semanticVersion.toString().padStart(4, "0")}-4000-8000-${country.id.slice(-12)}`,
    learningCardId: card.id,
    revision: 1,
    promptAssetId:
      country.key === "country.russia" && card.semanticVersion === 2
        ? assetId(country, 2)
        : assetId(country),
    promptFingerprint: sha256(`${card.id}:revision:1`),
    changeClassification: RevisionChangeClassification.TECHNICAL,
    progressPolicy: ProgressPolicy.PRESERVE,
    contentVersion: CONTENT_VERSION,
    effectiveFrom: CREATED_AT,
    retiredAt:
      country.key === "country.switzerland" ? "2026-07-28T12:30:00.000Z" : null,
  };

  if (
    country.key !== "country.switzerland" ||
    card.status !== CardStatus.ACTIVE
  ) {
    return [firstRevision];
  }

  return [
    firstRevision,
    {
      ...firstRevision,
      id: `60000001-${card.semanticVersion.toString().padStart(4, "0")}-4000-8000-${country.id.slice(-12)}`,
      revision: 2,
      promptAssetId: assetId(country, 2),
      promptFingerprint: sha256(`${card.id}:revision:2`),
      effectiveFrom: "2026-07-28T12:30:00.000Z",
      retiredAt: null,
    },
  ];
});

export const TEST_CONTENT_FIXTURE = {
  marker: "TEST_ONLY",
  version: CONTENT_VERSION,
  createdAt: CREATED_AT,
  manifestChecksum: sha256(JSON.stringify(manifest)),
  manifest,
  sources: [
    {
      id: ASSET_SOURCE_ID,
      name: "flag-icons test fixture",
      url: "https://github.com/lipis/flag-icons",
      licenseName: "MIT",
      licenseUrl: "https://opensource.org/license/mit",
      retrievedAt: CREATED_AT,
      metadata: { marker: "TEST_ONLY", revision: "fixture-v1" },
    },
    {
      id: NAMES_SOURCE_ID,
      name: "Country Flags editorial test fixture",
      url: "https://country-flags.test/fixtures/names",
      licenseName: "CC0-1.0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      retrievedAt: CREATED_AT,
      metadata: { marker: "TEST_ONLY", revision: "fixture-v1" },
    },
  ],
  entities: [
    ...countries.map((country) => ({
      id: country.id,
      contentKey: country.key,
      kind: GeoEntityKind.COUNTRY,
      slug: country.slug,
      isoAlpha2: country.alpha2 ?? null,
      isoAlpha3: country.alpha3 ?? null,
      m49Code: country.m49 ?? null,
      customCode: country.customCode ?? null,
      status: GeoEntityStatus.ACTIVE,
      includeInCountryCatalog: true,
      recognitionStatus: country.recognitionStatus,
      metadata: { marker: "TEST_ONLY" },
      contentVersion: CONTENT_VERSION,
    })),
    ...regions.map((region) => ({
      id: region.id,
      contentKey: region.key,
      kind: GeoEntityKind.REGION,
      slug: region.slug,
      isoAlpha2: null,
      isoAlpha3: null,
      m49Code: null,
      customCode: null,
      status: GeoEntityStatus.ACTIVE,
      includeInCountryCatalog: false,
      recognitionStatus: RecognitionStatus.NOT_APPLICABLE,
      metadata: { marker: "TEST_ONLY" },
      contentVersion: CONTENT_VERSION,
    })),
  ],
  names: [...countries, ...regions].flatMap((entity, entityIndex) =>
    (["en", "ru"] as const).map((locale, localeIndex) => ({
      id: `31000000-${(entityIndex + 1).toString().padStart(4, "0")}-4000-8000-00000000000${localeIndex + 1}`,
      geoEntityId: entity.id,
      locale,
      nameType: GeoNameType.SHORT,
      value: entity[locale],
      isPrimary: true,
      sourceId: NAMES_SOURCE_ID,
    })),
  ),
  relations: [
    ...countries
      .filter(({ inEurope }) => inEurope)
      .map((country, index) => ({
        id: `32000000-0000-4000-8000-0000000000${(index + 1)
          .toString()
          .padStart(2, "0")}`,
        parentEntityId: regions[0]!.id,
        childEntityId: country.id,
        taxonomyCode: "EDITORIAL_V1",
        relationType: GeoRelationType.CONTAINS,
        sortOrder: country.sortOrder,
        metadata: {
          marker: "TEST_ONLY",
          transcontinental: ["country.kazakhstan", "country.russia"].includes(
            country.key,
          ),
        },
      })),
    ...countries
      .filter(({ key }) =>
        ["country.kazakhstan", "country.nepal", "country.russia"].includes(key),
      )
      .map((country, index) => ({
        id: `32000001-0000-4000-8000-0000000000${(index + 1)
          .toString()
          .padStart(2, "0")}`,
        parentEntityId: regions[1]!.id,
        childEntityId: country.id,
        taxonomyCode: "EDITORIAL_V1",
        relationType: GeoRelationType.CONTAINS,
        sortOrder: country.sortOrder,
        metadata: {
          marker: "TEST_ONLY",
          transcontinental: ["country.kazakhstan", "country.russia"].includes(
            country.key,
          ),
        },
      })),
  ],
  assets,
  template: {
    id: TEMPLATE_ID,
    code: "FLAG_TO_COUNTRY",
    schemaVersion: 1,
    promptType: "FLAG_ASSET",
    answerType: "GEO_ENTITY_NAME",
    gradingMode: GradingMode.SELF_RATED,
    promptSpec: { assetType: "FLAG" },
    answerSpec: { nameType: "SHORT" },
    backSideFactTypes: [],
    status: PublicationStatus.PUBLISHED,
  },
  learningCards,
  revisions,
  decks: [
    {
      id: "70000000-0000-4000-8000-000000000001",
      code: "ALL",
      kind: DeckKind.CURATED,
      ruleSpec: { marker: "TEST_ONLY", source: "fixture" },
      status: DeckStatus.PUBLISHED,
      contentVersion: CONTENT_VERSION,
      localizations: [
        {
          locale: "en",
          name: "All countries",
          description: "All countries from the test fixture",
        },
        {
          locale: "ru",
          name: "Все страны",
          description: "Все страны из тестового набора",
        },
      ],
      countryKeys: countries.map(({ key }) => key),
    },
    {
      id: "70000000-0000-4000-8000-000000000002",
      code: "EUROPE",
      kind: DeckKind.TAXONOMY,
      ruleSpec: {
        marker: "TEST_ONLY",
        taxonomyCode: "EDITORIAL_V1",
        region: "region.europe",
      },
      status: DeckStatus.PUBLISHED,
      contentVersion: CONTENT_VERSION,
      localizations: [
        {
          locale: "en",
          name: "Europe",
          description: "European and transcontinental countries",
        },
        {
          locale: "ru",
          name: "Европа",
          description: "Европейские и трансконтинентальные страны",
        },
      ],
      countryKeys: countries
        .filter(({ inEurope }) => inEurope)
        .map(({ key }) => key),
    },
  ],
  releaseStatus: ContentReleaseStatus.PUBLISHED,
} as const;
