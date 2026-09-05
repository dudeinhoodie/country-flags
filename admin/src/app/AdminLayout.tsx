import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import LocalOfferOutlinedIcon from "@mui/icons-material/LocalOfferOutlined";
import SpaceDashboardOutlinedIcon from "@mui/icons-material/SpaceDashboardOutlined";
import StorefrontOutlinedIcon from "@mui/icons-material/StorefrontOutlined";
import SyncOutlinedIcon from "@mui/icons-material/SyncOutlined";
import {
  AppBar,
  Layout,
  Menu,
  TitlePortal,
  useResourceDefinitions,
  useSidebarState,
} from "react-admin";
import type { ReactNode } from "react";
import { BrandMark } from "../components/BrandMark";
import { EnvironmentBadge } from "../components/EnvironmentBadge";
import { useRuntimeConfig } from "../config/RuntimeConfigContext";
import { appBarSx } from "./theme";

function AdminAppBar() {
  const { environment } = useRuntimeConfig();
  // The bar itself carries the environment: ink for dev and local, an
  // unmissable crimson for prod — before the badge is even read.
  return (
    <AppBar color="transparent" sx={appBarSx(environment)}>
      <Stack
        direction="row"
        spacing={1.25}
        sx={{ alignItems: "center", mr: 2 }}
      >
        <BrandMark size={26} />
        <Typography
          variant="subtitle2"
          sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
        >
          Country Flags
        </Typography>
      </Stack>
      <Box
        sx={{
          width: "1px",
          alignSelf: "stretch",
          my: 1.75,
          mr: 2,
          backgroundColor: "currentColor",
          opacity: 0.25,
        }}
      />
      <TitlePortal variant="subtitle1" sx={{ opacity: 0.92 }} />
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mr: 1 }}>
        <EnvironmentBadge />
      </Box>
    </AppBar>
  );
}

/** Section label that folds away with the sidebar. */
function MenuSection({ label }: { label: string }) {
  const [open] = useSidebarState();
  if (!open) {
    return <Box sx={{ height: 16 }} />;
  }
  return (
    <Typography
      variant="overline"
      sx={{
        display: "block",
        px: 2.5,
        pt: 2,
        pb: 0.5,
        fontSize: "0.625rem",
        color: "text.secondary",
      }}
    >
      {label}
    </Typography>
  );
}

function AdminMenu() {
  const resources = useResourceDefinitions();
  return (
    <Menu>
      <Menu.Item
        to="/"
        primaryText="Dashboard"
        leftIcon={<SpaceDashboardOutlinedIcon />}
      />
      <MenuSection label="Catalog" />
      <Menu.ResourceItem name="entities" />
      <Menu.ResourceItem name="decks" />
      <MenuSection label="Editorial" />
      <Menu.ResourceItem name="drafts" />
      {/* Commerce sits beside Content rather than inside the deck list: an
          offer is not a deck, and one offer may open several. */}
      <MenuSection label="Commerce" />
      <Menu.Item
        to="/commerce/offers"
        primaryText="Offers"
        leftIcon={<LocalOfferOutlinedIcon />}
      />
      <Menu.Item
        to="/commerce/entitlements"
        primaryText="Entitlements"
        leftIcon={<KeyOutlinedIcon />}
      />
      <Menu.Item
        to="/commerce/products"
        primaryText="Store products"
        leftIcon={<StorefrontOutlinedIcon />}
      />
      <Menu.Item
        to="/commerce/sync"
        primaryText="Store sync"
        leftIcon={<SyncOutlinedIcon />}
      />
      {resources.users !== undefined && (
        <>
          <MenuSection label="Administration" />
          <Menu.ResourceItem name="users" />
        </>
      )}
    </Menu>
  );
}

export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Layout appBar={AdminAppBar} menu={AdminMenu}>
      {children}
    </Layout>
  );
}
