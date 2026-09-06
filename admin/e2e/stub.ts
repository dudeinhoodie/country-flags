import type { Page } from "@playwright/test";

/**
 * One console-shaped fixture, shared by every end-to-end suite.
 *
 * The stub exists because these tests are about the console — whether the
 * screens read what the API answers, whether roles hide what they must,
 * whether prod is unmistakable. Whether the API answers correctly is what the
 * backend's own integration suite proves, and running both against one stack
 * would make each failure ambiguous.
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

const DRAFT = {
  id: DRAFT_ID,
  baseContentVersion: "fixture-v1",
  baseCatalogCommit: "abc1234",
  schemaVersion: 1,
  revision: 3,
  status: "READY",
  proposalUrl: null,
  createdByAdminUserId: ADMIN_USER.id,
  updatedByAdminUserId: ADMIN_USER.id,
  createdAt: "2026-08-24T09:00:00Z",
  updatedAt: "2026-08-24T09:30:00Z",
  document: { decks: [], entities: [] },
  validationReport: {
    validatedAt: "2026-08-24T09:31:00Z",
    blocking: 0,
    warnings: 1,
    findings: [
      {
        level: "warning",
        code: "DECK_SMALL",
        subject: "deck.oceania",
        message: "The deck resolves to only 4 countries",
        // The server addresses its findings: the object, the tab of that
        // object's editor, and a pointer into the object (#356).
        target: {
          objectType: "deck",
          objectKey: "deck.oceania",
          tab: "content",
          field: "/members",
        },
        route: `/drafts/${DRAFT_ID}/decks/deck.oceania`,
      },
    ],
  },
};

const NO_LOCALE_GAPS = {
  required: ["en", "ru"],
  present: ["en", "ru"],
  missing: [],
  complete: true,
};

const FRANCE_DETAIL = {
  entity: {
    key: "country.france",
    type: "country",
    status: "active",
    includeInCountryCatalog: true,
    recognitionStatus: "un_member",
    parentKey: null,
    identifiers: { isoAlpha2: "FR" },
  },
  publishedNames: { en: "France", ru: "Франция" },
  draftRevision: 3,
  delivery: "PUBLIC",
  locales: NO_LOCALE_GAPS,
  assets: [
    {
      assetType: "FLAG",
      state: "empty",
      delivery: null,
      draftAssetId: null,
      provenanceComplete: false,
      processing: null,
      retired: false,
      localizations: NO_LOCALE_GAPS,
      usedByCardIds: [],
      usedByDeckKeys: [],
      unlocksTemplates: ["FLAG_TO_COUNTRY"],
    },
  ],
  usages: [],
  validation: { blocking: 0, warnings: 0, findings: [] },
};

const OCEANIA_DETAIL = {
  key: "deck.oceania",
  kind: "curated",
  names: {
    ru: { name: "Океания", description: "" },
    en: { name: "Oceania", description: "" },
  },
  membersMode: "explicit",
  members: ["country.france", "country.fiji"],
  memberCount: 2,
  defaultTemplateCode: "FLAG_TO_COUNTRY",
  defaultTemplateSchemaVersion: 1,
  previewCardIds: [],
  memberKeys: ["country.france", "country.fiji"],
  resolvedMemberCards: [],
  previewCards: [],
  summary: {
    cardCount: 2,
    templateCodes: ["FLAG_TO_COUNTRY"],
    missingAssetCount: 0,
    locales: NO_LOCALE_GAPS,
    previewCardCount: 0,
    delivery: { public: 2, publicPreview: 0, paidOnly: 0 },
    blocking: 0,
    warnings: 1,
  },
  access: {
    model: "FREE",
    requiredEntitlementKey: null,
    published: null,
    entitlementKnown: false,
    offerCodes: [],
    storeProducts: [],
    sellable: true,
  },
  validation: {
    blocking: 0,
    warnings: 1,
    findings: [
      {
        level: "warning",
        code: "DECK_SMALL",
        subject: "deck.oceania",
        message: "The deck resolves to only 4 countries",
        target: {
          objectType: "deck",
          objectKey: "deck.oceania",
          tab: "content",
          field: "/members",
        },
        route: `/drafts/${DRAFT_ID}/decks/deck.oceania`,
      },
    ],
  },
  draftRevision: 3,
};

const CARD_CANDIDATES = {
  items: [
    {
      cardId: "country.fiji#FLAG_TO_COUNTRY@1",
      entityKey: "country.fiji",
      entityType: "country",
      entityStatus: "active",
      parentKey: null,
      entityName: "Fiji",
      templateCode: "FLAG_TO_COUNTRY",
      templateSchemaVersion: 1,
      assetType: "FLAG",
      hasAsset: true,
      locales: NO_LOCALE_GAPS,
      delivery: null,
      inDeck: true,
      available: false,
      disabledReason: {
        code: "ALREADY_IN_DECK",
        message: "The deck already holds it",
      },
    },
    {
      cardId: "country.tonga#FLAG_TO_COUNTRY@1",
      entityKey: "country.tonga",
      entityType: "country",
      entityStatus: "active",
      parentKey: null,
      entityName: "Tonga",
      templateCode: "FLAG_TO_COUNTRY",
      templateSchemaVersion: 1,
      assetType: "FLAG",
      hasAsset: true,
      locales: NO_LOCALE_GAPS,
      delivery: null,
      inDeck: false,
      available: true,
      disabledReason: null,
    },
  ],
  total: 2,
  draftRevision: 3,
};

const DRAFT_ENTITIES = [
  {
    key: "country.france",
    type: "country",
    status: "active",
    includeInCountryCatalog: true,
    recognitionStatus: "UN_MEMBER",
    identifiers: { isoAlpha2: "FR", isoAlpha3: "FRA" },
    parentKey: null,
    hasFlag: true,
    hasCoatOfArms: false,
    overrideCount: 0,
    publishedName: "Франция",
  },
];

const DRAFT_DECKS = [
  {
    key: "deck.oceania",
    kind: "curated",
    names: { ru: { name: "Океания", description: "" } },
    membersMode: "explicit",
    members: ["country.france"],
    memberCount: 1,
    defaultTemplateCode: "FLAG_TO_COUNTRY",
    defaultTemplateSchemaVersion: 1,
  },
];

export async function stubApi(
  page: Page,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const routes: Record<string, unknown> = {
    "/api/v1/admin/me": ADMIN_USER,
    "/api/v1/admin/content/status": {
      activeVersion: "fixture-v1",
      minimumClientVersion: "0.1.0",
      schemaVersion: 1,
      publishedAt: "2026-08-20T09:30:00Z",
      entityCount: 278,
      deckCount: 6,
    },
    "/api/v1/admin/content/entities": {
      items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
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
          contentVersion: "fixture-v1",
        },
      ],
      total: 1,
    },
    "/api/v1/admin/content/decks": {
      items: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          code: "ALL",
          kind: "CURATED",
          status: "PUBLISHED",
          cardCount: 250,
          nameRu: "Все страны",
          nameEn: "All countries",
          contentVersion: "fixture-v1",
        },
      ],
      total: 1,
    },
    "/api/v1/admin/content/drafts": { items: [DRAFT], total: 1 },
    [`/api/v1/admin/content/drafts/${DRAFT_ID}`]: DRAFT,
    [`/api/v1/admin/content/drafts/${DRAFT_ID}/decks`]: {
      items: DRAFT_DECKS,
      total: DRAFT_DECKS.length,
    },
    [`/api/v1/admin/content/drafts/${DRAFT_ID}/entities`]: {
      items: DRAFT_ENTITIES,
      total: DRAFT_ENTITIES.length,
    },
    [`/api/v1/admin/content/drafts/${DRAFT_ID}/assets`]: {
      items: [],
      total: 0,
    },
    [`/api/v1/admin/content/drafts/${DRAFT_ID}/entities/country.france`]:
      FRANCE_DETAIL,
    [`/api/v1/admin/content/drafts/${DRAFT_ID}/decks/deck.oceania`]:
      OCEANIA_DETAIL,
    [`/api/v1/admin/content/drafts/${DRAFT_ID}/card-candidates`]:
      CARD_CANDIDATES,
    [`/api/v1/admin/content/drafts/${DRAFT_ID}/diff`]: {
      baseContentVersion: "fixture-v1",
      isEmpty: false,
      entities: [],
      assets: [],
      decks: [
        {
          deckKey: "deck.oceania",
          publishedCode: "OCEANIA",
          change: "changed",
          details: [
            "Countries: 4 → 5",
            "Access: free → paid (deck.oceania) — this takes the deck away from everyone who has it",
            "Description (en) changed",
          ],
        },
      ],
    },
    "/api/v1/admin/content/releases/publish-run": {
      state: "IDLE",
      configured: false,
      activeVersion: "fixture-v1",
      lastRun: null,
    },
    "/api/v1/admin/commerce/status": {
      storeEnvironment: "SANDBOX",
      activeOfferCount: 0,
      offersWithoutValidatedProduct: 0,
    },
    "/api/v1/admin/commerce/entitlements": { items: [], total: 0 },
    "/api/v1/admin/commerce/offers": { items: [], total: 0 },
    "/api/v1/admin/content/releases/runs": {
      activeVersion: "fixture-v1",
      current: null,
      last: null,
    },
    ...overrides,
  };

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const body = routes[path];
    if (body !== undefined) {
      await route.fulfill({ json: body });
      return;
    }
    await route.fulfill({
      status: 404,
      json: {
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: `no stub for ${path}`,
          requestId: ADMIN_USER.id,
          details: {},
        },
      },
    });
  });
}
