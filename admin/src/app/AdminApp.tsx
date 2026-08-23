import { Admin, CustomRoutes } from "react-admin";
import { Route } from "react-router-dom";
import type { RuntimeConfig } from "../config/runtime-config";
import { RuntimeConfigProvider } from "../config/RuntimeConfigContext";
import { AdminLayout } from "./AdminLayout";
import { Dashboard } from "./Dashboard";
import { placeholderDataProvider } from "./data-provider";

export function AdminApp({ config }: { config: RuntimeConfig }) {
  return (
    <RuntimeConfigProvider config={config}>
      <Admin
        title="Country Flags Admin"
        layout={AdminLayout}
        dataProvider={placeholderDataProvider}
      >
        <CustomRoutes>
          <Route path="/" element={<Dashboard />} />
        </CustomRoutes>
      </Admin>
    </RuntimeConfigProvider>
  );
}
