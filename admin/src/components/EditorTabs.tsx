import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * The tabs of an editor, addressed by URL (§4.3, §6.2, §8.1).
 *
 * A tab is a route segment rather than component state, because a validation
 * finding has to be able to link to one: the server addresses a finding to an
 * object, a tab and a field, and a tab nobody can link to would leave the
 * click landing on the top of a long form (§9).
 *
 * They are links, so the browser's own affordances work — middle click, back,
 * a bookmark — and MUI's `Tabs` supplies the arrow-key roving focus the
 * tablist pattern asks for.
 */

export interface EditorTabDefinition {
  id: string;
  label: string;
  /** How many findings sit on this tab; shown as a count, never as colour alone. */
  issues?: number;
}

export function EditorTabs({
  tabs,
  current,
  hrefOf,
  label,
  idPrefix,
}: {
  tabs: readonly EditorTabDefinition[];
  current: string;
  hrefOf: (tabId: string) => string;
  /** What the tablist is called, for anyone who cannot see the editor. */
  label: string;
  idPrefix: string;
}) {
  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Tabs
        value={current}
        aria-label={label}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            value={tab.id}
            id={tabId(idPrefix, tab.id)}
            aria-controls={panelId(idPrefix, tab.id)}
            component={Link}
            to={hrefOf(tab.id)}
            label={
              tab.issues === undefined || tab.issues === 0 ? (
                tab.label
              ) : (
                <Stack
                  direction="row"
                  spacing={2}
                  sx={{ alignItems: "center" }}
                >
                  <span>{tab.label}</span>
                  <Badge
                    color="error"
                    badgeContent={tab.issues}
                    aria-label={`${String(tab.issues)} issues`}
                  />
                </Stack>
              )
            }
          />
        ))}
      </Tabs>
    </Box>
  );
}

export function tabId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}

export function panelId(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`;
}

/**
 * What one tab shows. Focusable in its own right, so a keyboard reader
 * arriving from the tablist can step into the fields rather than past them.
 */
export function EditorTabPanel({
  idPrefix,
  tab,
  current,
  children,
}: {
  idPrefix: string;
  tab: string;
  current: string;
  children: ReactNode;
}) {
  if (tab !== current) {
    return null;
  }
  return (
    <Box
      role="tabpanel"
      id={panelId(idPrefix, tab)}
      aria-labelledby={tabId(idPrefix, tab)}
      tabIndex={0}
      sx={{ pt: 3, outline: "none" }}
    >
      {children}
    </Box>
  );
}
