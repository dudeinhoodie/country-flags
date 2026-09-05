import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import PublicOutlinedIcon from "@mui/icons-material/PublicOutlined";
import StyleOutlinedIcon from "@mui/icons-material/StyleOutlined";
import type { ReactNode } from "react";
import { usePermissions } from "react-admin";
import { Link, useParams } from "react-router-dom";
import { routes } from "../../app/routes";
import { LoadingState } from "../../components/LoadingState";
import { MetaItem, PageHeader } from "../../components/PageHeader";
import { relativeTime } from "../../components/relative-time";
import { ErrorState } from "../../components/StateViews";
import { StatusChip } from "../../components/StatusChip";
import { useDraftEntities } from "./useDraftEntities";
import { useDraftWithDecks } from "./useDraftDecks";

function canEdit(permissions: unknown): boolean {
  return (
    permissions === "EDITOR" ||
    permissions === "PUBLISHER" ||
    permissions === "ADMIN"
  );
}

/**
 * Where one draft stands (§4.3, `/drafts/:draftId/overview`).
 *
 * The workspace answers "what next" across the deployment; this answers it
 * for a draft an editor has deliberately opened — what it was branched
 * from, what is inside it, and the four places its work happens.
 */
export function DraftOverview() {
  const { draftId } = useParams();
  const { permissions } = usePermissions<string>();
  const { draft, decks, error } = useDraftWithDecks(draftId ?? "");
  const { entities } = useDraftEntities(draftId ?? "");
  const editable = canEdit(permissions);

  if (error !== null) {
    return <ErrorState message={error} />;
  }
  if (draft === null || decks === null) {
    return <LoadingState label="Loading the draft…" />;
  }

  const missingFlags = (entities ?? []).filter(
    (entity) => entity.includeInCountryCatalog && entity.hasFlag === false,
  ).length;

  return (
    <Box sx={{ pb: 4 }}>
      <PageHeader
        title="Draft overview"
        description={`Branched from content version ${draft.baseContentVersion}, catalog commit ${draft.baseCatalogCommit}.`}
        surface="draft"
        surfaceNote={`revision ${String(draft.revision)}`}
        meta={
          <>
            <MetaItem label="Status">
              <StatusChip value={draft.status} />
            </MetaItem>
            <MetaItem label="Updated">{relativeTime(draft.updatedAt)}</MetaItem>
            <MetaItem label="Created">{relativeTime(draft.createdAt)}</MetaItem>
          </>
        }
        actions={
          <>
            <Button
              component="a"
              href={`/api/v1/admin/content/drafts/${draft.id}/export`}
              size="small"
            >
              Download export
            </Button>
            <Button
              component={Link}
              to={routes.draftRelease(draft.id)}
              size="small"
              variant="contained"
            >
              Validation &amp; release
            </Button>
          </>
        }
      />

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
            lg: "repeat(4, minmax(0, 1fr))",
          },
        }}
      >
        <SectionCard
          icon={<PublicOutlinedIcon />}
          title="Countries & regions"
          value={entities === null ? "—" : String(entities.length)}
          hint={
            missingFlags === 0
              ? "Every catalog country has a flag"
              : `${String(missingFlags)} without a flag`
          }
          to={routes.draftEntities(draft.id)}
        />
        <SectionCard
          icon={<StyleOutlinedIcon />}
          title="Deck builder"
          value={String(decks.length)}
          hint={
            decks.length === 1 ? "deck in this draft" : "decks in this draft"
          }
          to={routes.draftDecks(draft.id)}
        />
        <SectionCard
          icon={<ImageOutlinedIcon />}
          title="Media"
          value="Uploads"
          hint="Flags and coats of arms in this draft"
          to={routes.draftMedia(draft.id)}
        />
        <SectionCard
          icon={<FactCheckOutlinedIcon />}
          title="Validation & release"
          value={draft.status}
          hint={
            editable ? "Validate, review and publish" : "Review and publish"
          }
          to={routes.draftRelease(draft.id)}
        />
      </Box>
    </Box>
  );
}

function SectionCard({
  icon,
  title,
  value,
  hint,
  to,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  hint: string;
  to: string;
}) {
  return (
    <Card
      component={Link}
      to={to}
      sx={{
        p: 2,
        display: "block",
        textDecoration: "none",
        color: "inherit",
        "&:hover": { borderColor: "primary.main" },
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
        <Box
          aria-hidden
          sx={{
            display: "grid",
            placeItems: "center",
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: 2,
            color: "primary.main",
            backgroundColor: "action.hover",
          }}
        >
          {icon}
        </Box>
        <Stack spacing={0.25} sx={{ minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary" component="h2">
            {title}
          </Typography>
          <Typography variant="h6" component="p" sx={{ lineHeight: 1.25 }}>
            {value}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        </Stack>
      </Stack>
    </Card>
  );
}
