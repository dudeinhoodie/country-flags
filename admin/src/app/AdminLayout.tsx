import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import LocalOfferOutlinedIcon from "@mui/icons-material/LocalOfferOutlined";
import ManageAccountsOutlinedIcon from "@mui/icons-material/ManageAccountsOutlined";
import PublicOutlinedIcon from "@mui/icons-material/PublicOutlined";
import SpaceDashboardOutlinedIcon from "@mui/icons-material/SpaceDashboardOutlined";
import StorefrontOutlinedIcon from "@mui/icons-material/StorefrontOutlined";
import StyleOutlinedIcon from "@mui/icons-material/StyleOutlined";
import SyncOutlinedIcon from "@mui/icons-material/SyncOutlined";
import {
  AppBar,
  Layout,
  Menu,
  usePermissions,
  useResourceDefinitions,
  useSidebarState,
} from "react-admin";
import type { ReactNode } from "react";
import { BrandMark } from "../components/BrandMark";
import { EnvironmentBadge } from "../components/EnvironmentBadge";
import { useRuntimeConfig } from "../config/RuntimeConfigContext";
import { CurrentDraftProvider, useCurrentDraft } from "./CurrentDraftContext";
import { DraftSelector } from "./DraftSelector";
import { GlobalSearch } from "./GlobalSearch";
import { routes } from "./routes";
import { SaveStatusProvider } from "./SaveStatusContext";
import { SaveStatusIndicator } from "./SaveStatusIndicator";
import { appBarSx, menuSectionSx } from "./theme";

/**
 * The bar every screen wears (§4.2): which deployment this is, which draft
 * is being worked in, one way to find anything, and whether the document on
 * screen is saved. None of it is per-screen, because none of those
 * questions stop mattering on any screen.
 */
function AdminAppBar() {
  const { environment } = useRuntimeConfig();
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
          sx={{
            fontWeight: 800,
            whiteSpace: "nowrap",
            display: { xs: "none", sm: "block" },
          }}
        >
          Country Flags
        </Typography>
      </Stack>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", minWidth: 0 }}
      >
        <DraftSelector />
        <EnvironmentBadge />
      </Stack>
      <Box sx={{ flexGrow: 1 }} />
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mr: 1 }}>
        <SaveStatusIndicator />
        <GlobalSearch />
        <ViewerRole />
      </Stack>
    </AppBar>
  );
}

/**
 * What this operator may do, next to who they are.
 *
 * The profile menu says the name; the role says why a button is missing,
 * which is the question a greyed-out console actually raises (§4.2).
 */
function ViewerRole() {
  const { permissions } = usePermissions<string>();
  if (typeof permissions !== "string" || permissions === "") {
    return null;
  }
  return (
    <Chip
      label={permissions}
      size="small"
      title={`You are signed in with the ${permissions} role`}
      sx={{
        height: 22,
        fontWeight: 700,
        display: { xs: "none", lg: "inline-flex" },
        color: "inherit",
        backgroundColor: "transparent",
        border: "1px solid",
        borderColor: "currentColor",
        opacity: 0.85,
      }}
    />
  );
}

/** Section label that folds away with the sidebar. */
function MenuSection({ label }: { label: string }) {
  const [open] = useSidebarState();
  if (!open) {
    return <Box sx={{ height: 16 }} />;
  }
  return (
    <Typography variant="overline" sx={menuSectionSx}>
      {label}
    </Typography>
  );
}

/**
 * Four groups, and the line between the first two is the whole point
 * (§4.1): `Published content` is a read-only projection of the active
 * release, and nothing outside `Draft workspace` can change anything.
 */
function AdminMenu() {
  const resources = useResourceDefinitions();
  const { draft } = useCurrentDraft();
  return (
    <Menu>
      <Menu.Item
        to={routes.workspace}
        primaryText="Overview"
        leftIcon={<SpaceDashboardOutlinedIcon />}
      />

      <MenuSection label="Published content" />
      <Menu.Item
        to={routes.publishedEntities}
        primaryText="Countries & regions"
        leftIcon={<PublicOutlinedIcon />}
      />
      <Menu.Item
        to={routes.publishedDecks}
        primaryText="Decks"
        leftIcon={<StyleOutlinedIcon />}
      />

      <MenuSection label="Draft workspace" />
      {draft === null ? (
        <Menu.Item
          to={routes.workspace}
          primaryText="Create a draft"
          leftIcon={<AddCircleOutlineIcon />}
        />
      ) : (
        <>
          <Menu.Item
            to={routes.draftEntities(draft.id)}
            primaryText="Countries & regions"
            leftIcon={<PublicOutlinedIcon />}
          />
          <Menu.Item
            to={routes.draftDecks(draft.id)}
            primaryText="Deck builder"
            leftIcon={<StyleOutlinedIcon />}
          />
          <Menu.Item
            to={routes.draftMedia(draft.id)}
            primaryText="Media"
            leftIcon={<ImageOutlinedIcon />}
          />
          <Menu.Item
            to={routes.draftRelease(draft.id)}
            primaryText="Validation & release"
            leftIcon={<FactCheckOutlinedIcon />}
          />
        </>
      )}

      {/* Commerce sits beside content rather than inside the deck list: an
          offer is not a deck, and one offer may open several. */}
      <MenuSection label="Commerce" />
      <Menu.Item
        to={routes.commerceOffers}
        primaryText="Offers"
        leftIcon={<LocalOfferOutlinedIcon />}
      />
      <Menu.Item
        to={routes.commerceEntitlements}
        primaryText="Entitlements"
        leftIcon={<KeyOutlinedIcon />}
      />
      <Menu.Item
        to={routes.commerceProducts}
        primaryText="Store products"
        leftIcon={<StorefrontOutlinedIcon />}
      />
      <Menu.Item
        to={routes.commerceSync}
        primaryText="Diagnostics"
        leftIcon={<SyncOutlinedIcon />}
      />

      {resources.users !== undefined && (
        <>
          <MenuSection label="Administration" />
          <Menu.Item
            to={routes.users}
            primaryText="Users & roles"
            leftIcon={<ManageAccountsOutlinedIcon />}
          />
        </>
      )}
    </Menu>
  );
}

export function AdminLayout({ children }: { children: ReactNode }) {
  // Both providers wrap the layout rather than a page: the draft is in the
  // app bar and in the navigation, and save status is read by the bar while
  // it is written by whatever screen is inside.
  return (
    <CurrentDraftProvider>
      <SaveStatusProvider>
        <Layout appBar={AdminAppBar} menu={AdminMenu}>
          {children}
        </Layout>
      </SaveStatusProvider>
    </CurrentDraftProvider>
  );
}
