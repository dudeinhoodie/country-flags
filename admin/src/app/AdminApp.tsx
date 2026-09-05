import ManageAccountsOutlinedIcon from "@mui/icons-material/ManageAccountsOutlined";
import { useMemo } from "react";
import type { ReactNode } from "react";
import {
  Admin,
  CustomRoutes,
  Resource,
  ResourceContextProvider,
} from "react-admin";
import { Navigate, Route, useParams } from "react-router-dom";
import { ApiClientProvider } from "../api/ApiClientContext";
import { createAdminApiClient } from "../api/client";
import type { RuntimeConfig } from "../config/runtime-config";
import { RuntimeConfigProvider } from "../config/RuntimeConfigContext";
import { AccessEdit } from "../resources/access/AccessEdit";
import { AccessList } from "../resources/access/AccessList";
import { EntitlementsPage } from "../resources/commerce/EntitlementsPage";
import { OfferDetail } from "../resources/commerce/OfferDetail";
import { OffersPage } from "../resources/commerce/OffersPage";
import { StoreProductsPage } from "../resources/commerce/StoreProductsPage";
import { StoreSyncPage } from "../resources/commerce/StoreSyncPage";
import { DeckEditor } from "../resources/drafts/DeckEditor";
import { DraftEntities } from "../resources/drafts/DraftEntities";
import { EntityEditor } from "../resources/drafts/EntityEditor";
import { DeckList } from "../resources/decks/DeckList";
import { DeckShow } from "../resources/decks/DeckShow";
import { EntityList } from "../resources/entities/EntityList";
import { DraftAssetsPage } from "../resources/drafts/DraftAssetsPage";
import { DraftDecks } from "../resources/drafts/DraftDecks";
import { DraftList } from "../resources/drafts/DraftList";
import { DraftOverview } from "../resources/drafts/DraftOverview";
import { DraftRelease } from "../resources/drafts/DraftRelease";
import { EntityShow } from "../resources/entities/EntityShow";
import { AdminLayout } from "./AdminLayout";
import { createAuthProvider } from "./auth-provider";
import { ContentWorkspace } from "./ContentWorkspace";
import { createAdminDataProvider } from "./data-provider";
import { LoginPage } from "./LoginPage";
import { legacyRoutes } from "./routes";
import type { LegacyRoute } from "./routes";
import { darkTheme, lightTheme } from "./theme";

/**
 * A read-only screen, told which resource it is reading.
 *
 * The published lists are custom routes rather than react-admin resource
 * routes, because their address (`/published/...`) is part of the
 * information architecture: `/entities` would put a read-only projection
 * and an editable draft on sibling URLs, which is exactly the confusion the
 * redesign removes (§4.1). They still need the resource in context for the
 * data provider to be asked the right question.
 */
function InResource({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ResourceContextProvider value={name}>{children}</ResourceContextProvider>
  );
}

/** Sends an address the console used to serve to the screen it became. */
function LegacyRedirect({ to }: { to: LegacyRoute["to"] }) {
  const params = useParams();
  return <Navigate to={to(params)} replace />;
}

export function AdminApp({ config }: { config: RuntimeConfig }) {
  const providers = useMemo(() => {
    const client = createAdminApiClient(config.apiBasePath);
    return {
      client,
      dataProvider: createAdminDataProvider(client),
      authProvider: createAuthProvider(client),
    };
  }, [config]);
  return (
    <RuntimeConfigProvider config={config}>
      <ApiClientProvider client={providers.client}>
        <Admin
          title="Country Flags Admin"
          layout={AdminLayout}
          theme={lightTheme}
          darkTheme={darkTheme}
          dataProvider={providers.dataProvider}
          authProvider={providers.authProvider}
          loginPage={LoginPage}
          requireAuth
        >
          {(permissions: unknown) => (
            <>
              <CustomRoutes>
                <Route path="/" element={<ContentWorkspace />} />

                {/* Published content: what the clients are being served,
                    and nothing here writes. */}
                <Route
                  path="/published/entities"
                  element={
                    <InResource name="entities">
                      <EntityList />
                    </InResource>
                  }
                />
                <Route
                  path="/published/entities/:id"
                  element={
                    <InResource name="entities">
                      <EntityShow />
                    </InResource>
                  }
                />
                <Route
                  path="/published/decks"
                  element={
                    <InResource name="decks">
                      <DeckList />
                    </InResource>
                  }
                />
                <Route
                  path="/published/decks/:id"
                  element={
                    <InResource name="decks">
                      <DeckShow />
                    </InResource>
                  }
                />

                {/* Draft workspace: the only surface that changes anything.
                    A draft and its decks are one editing surface rather
                    than two CRUD resources: every deck write carries the
                    draft's revision. */}
                <Route
                  path="/drafts"
                  element={
                    <InResource name="drafts">
                      <DraftList />
                    </InResource>
                  }
                />
                <Route
                  path="/drafts/:draftId/overview"
                  element={<DraftOverview />}
                />
                <Route
                  path="/drafts/:draftId/entities"
                  element={<DraftEntities />}
                />
                {/* The tab segment is accepted before the tabbed editors
                    exist (#317, #318), so a validation finding that points
                    at a field can already be linked to. */}
                <Route
                  path="/drafts/:draftId/entities/:entityKey"
                  element={<EntityEditor />}
                />
                <Route
                  path="/drafts/:draftId/entities/:entityKey/:tab"
                  element={<EntityEditor />}
                />
                <Route path="/drafts/:draftId/decks" element={<DraftDecks />} />
                <Route
                  path="/drafts/:draftId/decks/:deckKey"
                  element={<DeckEditor />}
                />
                <Route
                  path="/drafts/:draftId/decks/:deckKey/:tab"
                  element={<DeckEditor />}
                />
                <Route
                  path="/drafts/:draftId/media"
                  element={<DraftAssetsPage />}
                />
                <Route
                  path="/drafts/:draftId/release"
                  element={<DraftRelease />}
                />

                {/* Commerce is its own section rather than a resource: the
                    contract's commerce lists are whole answers, not pages,
                    so there is nothing for a data provider to paginate. */}
                <Route path="/commerce/offers" element={<OffersPage />} />
                <Route
                  path="/commerce/offers/:offerId"
                  element={<OfferDetail />}
                />
                <Route
                  path="/commerce/entitlements"
                  element={<EntitlementsPage />}
                />
                <Route
                  path="/commerce/products"
                  element={<StoreProductsPage />}
                />
                <Route path="/commerce/sync" element={<StoreSyncPage />} />

                {/* Bookmarks and audit-log links from before the redesign
                    keep resolving (§4.3). */}
                {legacyRoutes.map((legacy) => (
                  <Route
                    key={legacy.from}
                    path={legacy.from}
                    element={<LegacyRedirect to={legacy.to} />}
                  />
                ))}
              </CustomRoutes>
              {/* Server-side RBAC is the real gate; hiding the screen from
                  everyone below ADMIN just keeps the menu honest. */}
              {permissions === "ADMIN" ? (
                <Resource
                  name="users"
                  options={{ label: "Users & roles" }}
                  icon={ManageAccountsOutlinedIcon}
                  list={AccessList}
                  edit={AccessEdit}
                />
              ) : null}
            </>
          )}
        </Admin>
      </ApiClientProvider>
    </RuntimeConfigProvider>
  );
}
