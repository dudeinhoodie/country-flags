/**
 * Every console URL in one place (docs/19-admin-redesign §4.3).
 *
 * The address bar is part of the information architecture: `/published/...`
 * is a read-only projection of the active release and `/drafts/:draftId/...`
 * is the only place anything changes. A screen that built its own link
 * would be free to blur that line, so links are built here.
 */

/**
 * The query key that carries an RFC 6901 field pointer through a route.
 *
 * A validation finding names the object, the tab and the field (§9). The
 * first two are path segments; the field is a pointer into the object as the
 * admin API returns it — `/parentKey`, `/members/3` — and a pointer is not a
 * route, so it travels as a query parameter.
 */
export const FIELD_PARAM = "field";

export const routes = {
  /** The action-oriented Content workspace. */
  workspace: "/",
  publishedEntities: "/published/entities",
  publishedEntity: (entityId: string) => `/published/entities/${entityId}`,
  publishedDecks: "/published/decks",
  publishedDeck: (deckId: string) => `/published/decks/${deckId}`,
  /** Every draft, for switching between them. */
  drafts: "/drafts",
  draftOverview: (draftId: string) => `/drafts/${draftId}/overview`,
  draftEntities: (draftId: string) => `/drafts/${draftId}/entities`,
  draftEntity: (draftId: string, entityKey: string) =>
    `/drafts/${draftId}/entities/${entityKey}`,
  draftDecks: (draftId: string) => `/drafts/${draftId}/decks`,
  draftDeck: (draftId: string, deckKey: string) =>
    `/drafts/${draftId}/decks/${deckKey}`,
  draftMedia: (draftId: string) => `/drafts/${draftId}/media`,
  draftRelease: (draftId: string) => `/drafts/${draftId}/release`,
  commerceOffers: "/commerce/offers",
  commerceOffer: (offerId: string) => `/commerce/offers/${offerId}`,
  commerceEntitlements: "/commerce/entitlements",
  commerceProducts: "/commerce/products",
  commerceSync: "/commerce/sync",
  users: "/users",
} as const;

/**
 * Where a bookmark from before the redesign lands.
 *
 * Audit-log entries and shared links carry the old addresses forever, so
 * each one keeps resolving to the screen it became rather than to a blank
 * page (§4.3, acceptance criterion 10). The table is exported so the route
 * tests can walk it instead of restating it.
 */
export interface LegacyRoute {
  /** The route pattern the console used to serve. */
  from: string;
  /** The screen it became, given the matched path parameters. */
  to: (params: Readonly<Record<string, string | undefined>>) => string;
}

export const legacyRoutes: readonly LegacyRoute[] = [
  { from: "/entities", to: () => routes.publishedEntities },
  {
    from: "/entities/:id/show",
    to: (params) => routes.publishedEntity(params.id ?? ""),
  },
  { from: "/decks", to: () => routes.publishedDecks },
  {
    from: "/decks/:id/show",
    to: (params) => routes.publishedDeck(params.id ?? ""),
  },
  {
    from: "/drafts/:draftId",
    to: (params) => routes.draftOverview(params.draftId ?? ""),
  },
  {
    from: "/drafts/:draftId/assets",
    to: (params) => routes.draftMedia(params.draftId ?? ""),
  },
];
