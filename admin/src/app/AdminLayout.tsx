import Box from "@mui/material/Box";
import { AppBar, Layout, TitlePortal } from "react-admin";
import type { ReactNode } from "react";
import { EnvironmentBadge } from "../components/EnvironmentBadge";
import { useRuntimeConfig } from "../config/RuntimeConfigContext";

function AdminAppBar() {
  const { environment } = useRuntimeConfig();
  // The red bar makes prod unmistakable even before the badge is read.
  return (
    <AppBar color={environment === "prod" ? "error" : "primary"}>
      <TitlePortal />
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mr: 1 }}>
        <EnvironmentBadge />
      </Box>
    </AppBar>
  );
}

export function AdminLayout({ children }: { children: ReactNode }) {
  return <Layout appBar={AdminAppBar}>{children}</Layout>;
}
