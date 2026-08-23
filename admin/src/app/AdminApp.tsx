import { useMemo } from "react";
import { Admin, CustomRoutes, Resource } from "react-admin";
import { Route } from "react-router-dom";
import { ApiClientProvider } from "../api/ApiClientContext";
import { createAdminApiClient } from "../api/client";
import type { RuntimeConfig } from "../config/runtime-config";
import { RuntimeConfigProvider } from "../config/RuntimeConfigContext";
import { AccessEdit } from "../resources/access/AccessEdit";
import { AccessList } from "../resources/access/AccessList";
import { DeckList } from "../resources/decks/DeckList";
import { DeckShow } from "../resources/decks/DeckShow";
import { EntityList } from "../resources/entities/EntityList";
import { EntityShow } from "../resources/entities/EntityShow";
import { AdminLayout } from "./AdminLayout";
import { createAuthProvider } from "./auth-provider";
import { Dashboard } from "./Dashboard";
import { createAdminDataProvider } from "./data-provider";
import { LoginPage } from "./LoginPage";

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
          dataProvider={providers.dataProvider}
          authProvider={providers.authProvider}
          loginPage={LoginPage}
          requireAuth
        >
          {(permissions: unknown) => (
            <>
              <CustomRoutes>
                <Route path="/" element={<Dashboard />} />
              </CustomRoutes>
              <Resource
                name="entities"
                options={{ label: "Countries" }}
                list={EntityList}
                show={EntityShow}
              />
              <Resource
                name="decks"
                options={{ label: "Decks" }}
                list={DeckList}
                show={DeckShow}
              />
              {/* Server-side RBAC is the real gate; hiding the screen from
                  everyone below ADMIN just keeps the menu honest. */}
              {permissions === "ADMIN" ? (
                <Resource
                  name="users"
                  options={{ label: "Access" }}
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
