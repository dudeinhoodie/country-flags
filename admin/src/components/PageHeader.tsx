import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import EditNoteOutlinedIcon from "@mui/icons-material/EditNoteOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import type { ReactNode } from "react";

/**
 * What kind of surface the screen is.
 *
 * `published` is a read-only projection of the active release and
 * `draft` is somewhere writes land. The distinction is the whole point of
 * the information architecture (§3.4, §4.1): an editor must never be able
 * to mistake one for the other, so it is stated in words, in an icon and in
 * a colour rather than left to the URL.
 */
export type PageSurface = "published" | "draft" | "neutral";

const SURFACE_ACCENT: Record<PageSurface, string> = {
  published: "text.disabled",
  draft: "primary.main",
  neutral: "divider",
};

/**
 * The heading every screen wears: where you are, what surface it is, and
 * the one or two actions that belong to the page as a whole.
 */
export function PageHeader({
  title,
  description,
  surface = "neutral",
  surfaceNote,
  breadcrumbs,
  meta,
  actions,
}: {
  title: string;
  description?: string | undefined;
  surface?: PageSurface | undefined;
  /** What the badge says beyond the surface itself, e.g. the draft's name. */
  surfaceNote?: string | undefined;
  breadcrumbs?: ReactNode;
  /** Small facts under the title: versions, counts, timestamps. */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Box
      component="header"
      sx={{
        display: "flex",
        gap: 2,
        alignItems: "flex-start",
        flexWrap: "wrap",
        pt: 3,
        pb: 2,
        borderLeft: 3,
        borderColor: SURFACE_ACCENT[surface],
        pl: 2,
      }}
    >
      <Stack spacing={0.75} sx={{ flexGrow: 1, minWidth: 260 }}>
        {breadcrumbs !== undefined && (
          <Box sx={{ mb: 0.25 }}>{breadcrumbs}</Box>
        )}
        <Stack
          direction="row"
          spacing={1.25}
          useFlexGap
          sx={{ alignItems: "center", flexWrap: "wrap" }}
        >
          <Typography variant="h4" component="h1">
            {title}
          </Typography>
          {surface !== "neutral" && (
            <SurfaceBadge surface={surface} note={surfaceNote} />
          )}
        </Stack>
        {description !== undefined && (
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        )}
        {meta !== undefined && (
          <Stack
            direction="row"
            spacing={1.5}
            useFlexGap
            sx={{ flexWrap: "wrap", alignItems: "center", pt: 0.5 }}
          >
            {meta}
          </Stack>
        )}
      </Stack>
      {actions !== undefined && (
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: "wrap", alignItems: "center", pt: 0.5 }}
        >
          {actions}
        </Stack>
      )}
    </Box>
  );
}

function SurfaceBadge({
  surface,
  note,
}: {
  surface: Exclude<PageSurface, "neutral">;
  note?: string | undefined;
}) {
  const published = surface === "published";
  const label = published ? "Published · read-only" : "Draft";
  return (
    <Chip
      size="small"
      variant={published ? "outlined" : "filled"}
      color={published ? undefined : "primary"}
      icon={
        published ? (
          <LockOutlinedIcon fontSize="small" />
        ) : (
          <EditNoteOutlinedIcon fontSize="small" />
        )
      }
      label={note === undefined ? label : `${label} · ${note}`}
      sx={{ fontWeight: 700 }}
    />
  );
}

/** A quiet `label: value` pair for the header's meta row. */
export function MetaItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Typography variant="body2" color="text.secondary">
      <Box component="span" sx={{ fontWeight: 700 }}>
        {label}
      </Box>{" "}
      {children}
    </Typography>
  );
}
