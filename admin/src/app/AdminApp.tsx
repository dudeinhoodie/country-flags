import EditNoteOutlinedIcon from "@mui/icons-material/EditNoteOutlined";
import ManageAccountsOutlinedIcon from "@mui/icons-material/ManageAccountsOutlined";
import PublicOutlinedIcon from "@mui/icons-material/PublicOutlined";
import StyleOutlinedIcon from "@mui/icons-material/StyleOutlined";
import { useMemo } from "react";
import { Admin, CustomRoutes, Resource } from "react-admin";
import { Route } from "react-router-dom";
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
import { DraftList } from "../resources/drafts/DraftList";
import { DraftShow } from "../resources/drafts/DraftShow";
import { EntityShow } from "../resources/entities/EntityShow";
import { AdminLayout } from "./AdminLayout";
import { createAuthProvider } from "./auth-provider";
import { Dashboard } from "./Dashboard";
import { createAdminDataProvider } from "./data-provider";
import { LoginPage } from "./LoginPage";
import { darkTheme, lightTheme } from "./theme";

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
                <Route path="/" element={<Dashboard />} />
                {/* A draft and its decks are one editing surface rather
                    than two CRUD resources: every deck write carries the
                    draft's revision. */}
                <Route path="/drafts/:draftId" element={<DraftShow />} />
                <Route
                  path="/drafts/:draftId/decks/:deckKey"
                  element={<DeckEditor />}
                />
                <Route
                  path="/drafts/:draftId/assets"
                  element={<DraftAssetsPage />}
                />
                <Route
                  path="/drafts/:draftId/entities"
                  element={<DraftEntities />}
                />
                <Route
                  path="/drafts/:draftId/entities/:entityKey"
                  element={<EntityEditor />}
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
              </CustomRoutes>
              <Resource
                name="entities"
                options={{ label: "Countries" }}
                icon={PublicOutlinedIcon}
                list={EntityList}
                show={EntityShow}
              />
              <Resource
                name="drafts"
                options={{ label: "Drafts" }}
                icon={EditNoteOutlinedIcon}
                list={DraftList}
              />
              <Resource
                name="decks"
                options={{ label: "Decks" }}
                icon={StyleOutlinedIcon}
                list={DeckList}
                show={DeckShow}
              />
              {/* Server-side RBAC is the real gate; hiding the screen from
                  everyone below ADMIN just keeps the menu honest. */}
              {permissions === "ADMIN" ? (
                <Resource
                  name="users"
                  options={{ label: "Access" }}
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
