import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import CheckIcon from "@mui/icons-material/Check";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import { useState } from "react";
import { usePermissions } from "react-admin";
import { useNavigate } from "react-router-dom";
import { relativeTime } from "../components/relative-time";
import { useCurrentDraft } from "./CurrentDraftContext";
import { routes } from "./routes";

function canEdit(permissions: unknown): boolean {
  return (
    permissions === "EDITOR" ||
    permissions === "PUBLISHER" ||
    permissions === "ADMIN"
  );
}

/**
 * The draft the console is working in, on every screen (§4.2).
 *
 * Published content is read-only and everything else happens inside one
 * draft, so which draft it is belongs beside the environment rather than
 * three clicks away. Switching here re-points the whole Draft workspace
 * section of the navigation.
 */
export function DraftSelector() {
  const { drafts, draft, select, create, creating } = useCurrentDraft();
  const { permissions } = usePermissions<string>();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const editable = canEdit(permissions);

  const label =
    draft === null ? "No draft" : `Draft ${draft.baseContentVersion}`;

  return (
    <>
      <Button
        color="inherit"
        size="small"
        onClick={(event) => setAnchor(event.currentTarget)}
        startIcon={<LayersOutlinedIcon fontSize="small" />}
        endIcon={<ExpandMoreIcon fontSize="small" />}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-label={`Current draft: ${label}. Switch draft`}
        sx={{
          maxWidth: 260,
          flexShrink: 0,
          justifyContent: "flex-start",
          border: "1px solid",
          borderColor: "rgba(255, 255, 255, 0.28)",
          borderRadius: 2,
          px: 1.25,
        }}
      >
        <Box
          component="span"
          sx={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: 700,
          }}
        >
          {label}
        </Box>
        {draft !== null && (
          <Box
            component="span"
            sx={{
              ml: 0.75,
              opacity: 0.75,
              whiteSpace: "nowrap",
              display: { xs: "none", lg: "inline" },
            }}
          >
            rev {draft.revision}
          </Box>
        )}
      </Button>
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => setAnchor(null)}
        slotProps={{ list: { "aria-label": "Drafts" } }}
      >
        {drafts.length === 0 && (
          <MenuItem disabled>
            <ListItemText
              primary="No drafts yet"
              secondary="Start one from the current release"
            />
          </MenuItem>
        )}
        {drafts.map((candidate) => (
          <MenuItem
            key={candidate.id}
            selected={candidate.id === draft?.id}
            onClick={() => {
              select(candidate.id);
              setAnchor(null);
              void navigate(routes.draftOverview(candidate.id));
            }}
          >
            <Box
              sx={{ width: 24, display: "flex", alignItems: "center" }}
              aria-hidden
            >
              {candidate.id === draft?.id && <CheckIcon fontSize="small" />}
            </Box>
            <ListItemText
              primary={`Draft ${candidate.baseContentVersion}`}
              secondary={`rev ${String(candidate.revision)} · ${candidate.status.toLowerCase()} · updated ${relativeTime(candidate.updatedAt)}`}
            />
            <Chip
              size="small"
              variant="outlined"
              label={candidate.status}
              sx={{ ml: 1 }}
            />
          </MenuItem>
        ))}
        <Divider />
        {editable && (
          <MenuItem
            disabled={creating}
            onClick={() => {
              setAnchor(null);
              create().catch(() => {
                // The workspace reports the failure where the CTA lives.
              });
            }}
          >
            <Typography variant="body2">
              Create draft from current release
            </Typography>
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            setAnchor(null);
            void navigate(routes.drafts);
          }}
        >
          <Typography variant="body2">All drafts…</Typography>
        </MenuItem>
      </Menu>
    </>
  );
}
