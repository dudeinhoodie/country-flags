import { vi } from "vitest";

/**
 * One console-shaped fixture for the shell tests.
 *
 * The screens under test compose the draft, its decks, its entities and its
 * assets into a single picture, so a stub that answered only one of them
 * would prove nothing. Everything here is a whole answer in the shape the
 * admin contract promises.
 */

export const ADMIN_USER = {
  id: "8f1f9f76-1f0a-4a2e-9a5e-2b8f4f1c9d10",
  email: "root@country-flags.test",
  displayName: "root",
  role: "ADMIN",
  status: "ACTIVE",
  createdAt: "2026-08-24T09:00:00Z",
};

export const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
export const PUBLISHED_ENTITY_ID = "22222222-2222-4222-8222-222222222222";
export const PUBLISHED_DECK_ID = "33333333-3333-4333-8333-333333333333";

const VALIDATION_REPORT = {
  validatedAt: "2026-09-04T09:31:00Z",
  blocking: 1,
  warnings: 1,
  findings: [
    {
      level: "blocking",
      code: "CARD_ASSET_MISSING",
      subject: "deck.us_states",
      message: "A card has no flag to show",
    },
    {
      level: "warning",
      code: "ENTITY_COAT_MISSING",
      subject: "country.germany",
      message: "The coat of arms is missing",
    },
  ],
};

export const DRAFT_SUMMARY = {
  id: DRAFT_ID,
  baseContentVersion: "2026.09.01",
  baseCatalogCommit: "abc1234",
  schemaVersion: 1,
  revision: 3,
  status: "DRAFT",
  proposalUrl: null,
  createdByAdminUserId: ADMIN_USER.id,
  updatedByAdminUserId: ADMIN_USER.id,
  createdAt: "2026-09-04T09:00:00Z",
  updatedAt: "2026-09-04T09:30:00Z",
};

export const DRAFT_DETAIL = {
  ...DRAFT_SUMMARY,
  document: { decks: [], entities: [] },
  validationReport: VALIDATION_REPORT,
};

const DRAFT_ENTITIES = [
  {
    key: "country.germany",
    type: "country",
    status: "active",
    includeInCountryCatalog: true,
    recognitionStatus: "UN_MEMBER",
    identifiers: { isoAlpha2: "DE", isoAlpha3: "DEU" },
    parentKey: null,
    hasFlag: true,
    hasCoatOfArms: false,
    overrideCount: 0,
    publishedName: "Германия",
  },
  {
    key: "country.france",
    type: "country",
    status: "active",
    includeInCountryCatalog: true,
    recognitionStatus: "UN_MEMBER",
    identifiers: { isoAlpha2: "FR", isoAlpha3: "FRA" },
    parentKey: null,
    hasFlag: true,
    hasCoatOfArms: true,
    overrideCount: 0,
    publishedName: "Франция",
  },
  {
    key: "subdivision.us-ca",
    type: "subdivision",
    status: "active",
    includeInCountryCatalog: false,
    recognitionStatus: "NOT_APPLICABLE",
    identifiers: { isoSubdivision: "US-CA" },
    parentKey: "country.usa",
    hasFlag: false,
    hasCoatOfArms: false,
    overrideCount: 0,
    publishedName: null,
  },
];

const DRAFT_DECKS = [
  {
    key: "deck.european_coats",
    kind: "curated",
    names: { ru: { name: "Гербы Европы", description: "" } },
    membersMode: "explicit",
    members: [
      {
        entityKey: "country.germany",
        templateCode: "COAT_OF_ARMS_TO_COUNTRY",
        templateSchemaVersion: 1,
      },
      {
        entityKey: "country.france",
        templateCode: "COAT_OF_ARMS_TO_COUNTRY",
        templateSchemaVersion: 1,
      },
    ],
    memberCount: 2,
    defaultTemplateCode: "FLAG_TO_COUNTRY",
    defaultTemplateSchemaVersion: 1,
  },
  {
    key: "deck.us_states",
    kind: "curated",
    names: { ru: { name: "Флаги штатов США", description: "" } },
    membersMode: "explicit",
    members: ["subdivision.us-ca"],
    memberCount: 1,
    defaultTemplateCode: "FLAG_TO_COUNTRY",
    defaultTemplateSchemaVersion: 1,
  },
];

const DRAFT_ASSETS = [
  {
    id: "44444444-4444-4444-8444-444444444444",
    draftId: DRAFT_ID,
    entityContentKey: "country.france",
    assetType: "FLAG",
    variant: "default",
    mimeType: "image/svg+xml",
    sha256: "a".repeat(64),
    width: 900,
    height: 600,
    aspectRatio: 1.5,
    sourceUrl: null,
    licenseName: "CC0",
    licenseUrl: null,
    attribution: null,
    replacementReason: null,
    validationStatus: "VALID",
    createdAt: "2026-09-04T09:10:00Z",
    updatedAt: "2026-09-04T09:10:00Z",
  },
];

/** The routes the console asks for, keyed by path. */
export function adminApiRoutes(): Record<string, unknown> {
  return {
    "/api/v1/admin/me": ADMIN_USER,
    "/api/v1/admin/content/status": {
      activeVersion: "2026.09.01",
      minimumClientVersion: "0.1.0",
      schemaVersion: 1,
      publishedAt: "2026-09-02T10:00:00Z",
      entityCount: 278,
      deckCount: 6,
    },
    "/api/v1/admin/content/entities": {
      items: [
        {
          id: PUBLISHED_ENTITY_ID,
          contentKey: "country.france",
          slug: "france",
          kind: "COUNTRY",
          status: "ACTIVE",
          recognitionStatus: "UN_MEMBER",
          isoAlpha2: "FR",
          isoAlpha3: "FRA",
          nameRu: "Франция",
          nameEn: "France",
          flag: null,
          contentVersion: "2026.09.01",
        },
      ],
      total: 1,
    },
    "/api/v1/admin/content/decks": {
      items: [
        {
          id: PUBLISHED_DECK_ID,
          code: "ALL",
          kind: "CURATED",
          status: "PUBLISHED",
          cardCount: 250,
          nameRu: "Все страны",
          nameEn: "All countries",
          contentVersion: "2026.09.01",
        },
      ],
      total: 1,
    },
    "/api/v1/admin/content/drafts": { items: [DRAFT_SUMMARY], total: 1 },
    [`/api/v1/admin/content/drafts/${DRAFT_ID}`]: DRAFT_DETAIL,
    [`/api/v1/admin/content/drafts/${DRAFT_ID}/decks`]: {
      items: DRAFT_DECKS,
      total: DRAFT_DECKS.length,
    },
    [`/api/v1/admin/content/drafts/${DRAFT_ID}/entities`]: {
      items: DRAFT_ENTITIES,
      total: DRAFT_ENTITIES.length,
    },
    [`/api/v1/admin/content/drafts/${DRAFT_ID}/assets`]: {
      items: DRAFT_ASSETS,
      total: DRAFT_ASSETS.length,
    },
    [`/api/v1/admin/content/drafts/${DRAFT_ID}/diff`]: {
      entities: [],
      assets: [],
      decks: [],
    },
    "/api/v1/admin/content/releases/runs": {
      activeVersion: "2026.09.01",
      current: null,
      last: null,
    },
    "/api/v1/admin/content/releases/publish-run": {
      state: "IDLE",
      activeVersion: "2026.09.01",
      lastRun: null,
    },
  };
}

/** Answers the console's requests from the fixture; 404 for anything else. */
export function stubAdminApi(overrides: Record<string, unknown> = {}): void {
  const routes = { ...adminApiRoutes(), ...overrides };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: Request | URL | string) => {
      const raw = input instanceof Request ? input.url : input.toString();
      const { pathname } = new URL(raw, window.location.origin);
      const body = routes[pathname];
      if (body !== undefined) {
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: "RESOURCE_NOT_FOUND",
              message: `no stub for ${pathname}`,
              requestId: ADMIN_USER.id,
              details: {},
            },
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
      );
    }),
  );
}
